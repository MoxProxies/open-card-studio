<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * The same syncWithoutDetaching() race BadgeRulesTest covers, on the
 * staff hand-grant path — see that test's doc comment for why this hooks
 * the query itself (via DB::listen) rather than a model event.
 */
class ModerationControllerTest extends TestCase
{
    use RefreshDatabase;

    private function account(string $email, bool $staff = false): User
    {
        $user = User::create([
            'name' => str($email)->before('@')->headline()->toString(),
            'email' => $email,
            'username' => str($email)->before('@')->toString(),
            'password' => 'password123',
        ]);

        if ($staff) {
            $user->is_staff = true;
            $user->save();
        }

        return $user;
    }

    public function test_staff_can_hand_grant_a_manual_badge(): void
    {
        $staff = $this->account('staff@example.com', staff: true);
        $target = $this->account('target@example.com');

        $this->actingAs($staff)->postJson("/api/moderation/users/{$target->id}/badges", [
            'badge' => 'pillar',
            'granted' => true,
        ])->assertOk();

        $this->assertDatabaseHas('badge_user', ['badge_id' => 'pillar', 'user_id' => $target->id]);
    }

    public function test_a_raced_hand_grant_is_a_harmless_no_op_not_a_500(): void
    {
        $staff = $this->account('staff2@example.com', staff: true);
        $target = $this->account('target2@example.com');

        $raced = false;

        // Fires on syncWithoutDetaching()'s own internal "what's currently
        // attached" read, inside the request's own badge() call — after
        // it found the badge unattached, but before its own INSERT lands.
        // Reproduces exactly what a concurrent grant of the same badge
        // (another staff member's double-click, or a rule-based grant
        // landing at the same instant) would do.
        DB::listen(function ($query) use (&$raced, $target) {
            if ($raced || ! str_contains($query->sql, 'badge_user') || ! str_starts_with(ltrim($query->sql), 'select')) {
                return;
            }

            $raced = true;
            DB::table('badge_user')->insert([
                'badge_id' => 'pillar',
                'user_id' => $target->id,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        });

        // Without the fix this 500s: syncWithoutDetaching()'s own internal
        // attach hits the unique (badge_id, user_id) index directly,
        // unguarded.
        $this->actingAs($staff)->postJson("/api/moderation/users/{$target->id}/badges", [
            'badge' => 'pillar',
            'granted' => true,
        ])->assertOk();

        $this->assertTrue($raced);
        $this->assertSame(1, DB::table('badge_user')->where('badge_id', 'pillar')->where('user_id', $target->id)->count());
    }
}
