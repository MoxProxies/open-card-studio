<?php

namespace Tests\Feature;

use App\Models\Reaction;
use App\Models\Template;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * The race PointsLedger and Notifier already guard against, hitting the
 * one endpoint that writes the reactions table itself: the read-then-write
 * in toggle() isn't atomic, so a double-tap (or a retried request) can
 * send two creates in before either row lands. Reproduced the same way
 * those do — at the exact gap, via a model event — rather than relying on
 * a real thread race.
 */
class ReactionControllerTest extends TestCase
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

    private function template(User $owner): Template
    {
        return Template::create([
            'id' => (string) Str::uuid(),
            'user_id' => $owner->id,
            'name' => 'Likeable',
            'visibility' => 'published',
            'tags' => [],
            'design' => ['schemaVersion' => 1],
        ]);
    }

    public function test_liking_then_unliking_toggles_cleanly(): void
    {
        $owner = $this->account('owner@example.com');
        $liker = $this->account('liker@example.com');
        $template = $this->template($owner);

        $this->actingAs($liker)->postJson('/api/reactions', ['type' => 'template', 'id' => $template->id])
            ->assertOk()
            ->assertJson(['reacted' => true, 'reaction_count' => 1]);

        $this->actingAs($liker)->postJson('/api/reactions', ['type' => 'template', 'id' => $template->id])
            ->assertOk()
            ->assertJson(['reacted' => false, 'reaction_count' => 0]);
    }

    public function test_a_double_tap_that_loses_the_create_race_is_a_harmless_no_op_not_a_500(): void
    {
        $owner = $this->account('owner2@example.com');
        $liker = $this->account('liker2@example.com');
        $template = $this->template($owner);

        $raced = false;

        // Fires inside this request's own reactions()->create() call —
        // after toggle()'s own read already found no existing reaction,
        // but before that row exists. Creating it here reproduces exactly
        // what a second, concurrent tap of the same like button would do.
        Reaction::creating(function (Reaction $reaction) use (&$raced, $template, $liker) {
            if ($raced || $reaction->reactable_id !== $template->id || $reaction->user_id !== $liker->id) {
                return;
            }

            $raced = true;
            Reaction::create([
                'reactable_type' => $reaction->reactable_type,
                'reactable_id' => $template->id,
                'user_id' => $liker->id,
                'type' => Reaction::LIKE,
            ]);
        });

        // Without the fix this 500s: the create the controller attempts
        // after losing the race hits the unique index directly, unguarded.
        $this->actingAs($liker)->postJson('/api/reactions', ['type' => 'template', 'id' => $template->id])
            ->assertOk()
            ->assertJson(['reacted' => true, 'reaction_count' => 1]);

        $this->assertTrue($raced);
        // Exactly one row, not two — the losing side must not have
        // duplicated the reaction it was already too late to create.
        $this->assertSame(1, $template->reactions()->count());
    }
}
