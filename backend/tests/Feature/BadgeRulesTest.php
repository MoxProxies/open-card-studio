<?php

namespace Tests\Feature;

use App\Models\Template;
use App\Models\User;
use App\Support\BadgeRules;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * The race BadgeRules::evaluate() guards: syncWithoutDetaching() attaches
 * through the query builder, not through save(), so its own internal
 * read of what's currently attached and its eventual INSERT aren't
 * atomic either — two evaluate() calls for the same user landing at once
 * (a reaction and a publish, say) can both see a badge as unattached and
 * both try to attach it.
 *
 * That internal read-then-write happens inside Eloquent's own sync()
 * (Illuminate\Database\Eloquent\Relations\Concerns\InteractsWithPivotTable),
 * underneath any hook this codebase's model events could reach — attach()
 * writes through the query builder directly, firing no creating/saving
 * event. So instead of hooking a model event like the rest of this
 * codebase's race tests do, this hooks the query itself: DB::listen fires
 * synchronously right after a query executes and before its caller sees
 * the result. sync() itself already re-reads "what's currently attached"
 * right before it writes and quietly no-ops when it finds the badge
 * already there — which absorbs a race landing *before* that read, the
 * same way Eloquent's own updateOrCreate() self-heals a same-key race
 * elsewhere in this codebase (see the commit message). So reproducing an
 * actual collision means landing the competing row *after* sync()'s own
 * read, in the narrow gap before its INSERT — this listener skips the
 * first badge_user SELECT (evaluate()'s own $held check) and injects on
 * the second (sync()'s internal one).
 */
class BadgeRulesTest extends TestCase
{
    use RefreshDatabase;

    private function account(string $email): User
    {
        return User::create([
            'name' => str($email)->before('@')->headline()->toString(),
            'email' => $email,
            'username' => str($email)->before('@')->toString(),
            'password' => 'password123',
        ]);
    }

    /**
     * Created private and flipped to published with a raw update, not
     * Eloquent — Publishable::bootPublishable() already calls
     * BadgeRules::evaluate() on every save while published, which would
     * award the badge before either test below gets to make its own,
     * deliberately-timed call.
     */
    private function unevaluatedPublishedTemplate(User $user): void
    {
        $template = Template::create([
            'id' => (string) Str::uuid(),
            'user_id' => $user->id,
            'name' => 'First',
            'visibility' => 'private',
            'tags' => [],
            'design' => ['schemaVersion' => 1],
        ]);

        DB::table('templates')->where('id', $template->id)->update(['visibility' => 'published']);
    }

    public function test_evaluate_grants_a_newly_qualified_badge(): void
    {
        $user = $this->account('creator@example.com');
        $this->unevaluatedPublishedTemplate($user);

        $awarded = BadgeRules::evaluate($user);

        $this->assertSame(['first-template'], $awarded);
        $this->assertDatabaseHas('badge_user', ['badge_id' => 'first-template', 'user_id' => $user->id]);
    }

    public function test_a_raced_evaluation_is_a_harmless_no_op_not_a_500(): void
    {
        $user = $this->account('racer@example.com');
        $this->unevaluatedPublishedTemplate($user);

        $raced = false;
        $selects = 0;

        DB::listen(function ($query) use (&$raced, &$selects, $user) {
            if ($raced || ! str_contains($query->sql, 'badge_user') || ! str_starts_with(ltrim($query->sql), 'select')) {
                return;
            }

            // The first is evaluate()'s own $held read; sync()'s own
            // internal "currently attached" read is the second, and the
            // one whose gap this is reproducing.
            if (++$selects < 2) {
                return;
            }

            $raced = true;
            DB::table('badge_user')->insert([
                'badge_id' => 'first-template',
                'user_id' => $user->id,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        });

        // Without the fix this 500s: syncWithoutDetaching()'s own internal
        // attach hits the unique (badge_id, user_id) index directly,
        // unguarded.
        $awarded = BadgeRules::evaluate($user);

        $this->assertTrue($raced);
        $this->assertSame([], $awarded, 'the request that lost the race did not award anything itself');
        // Exactly one row, not two.
        $this->assertSame(1, DB::table('badge_user')->where('badge_id', 'first-template')->where('user_id', $user->id)->count());
    }
}
