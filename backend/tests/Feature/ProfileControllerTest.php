<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The username race ProfileController::update() shares with
 * AuthController::register(): the uniqueness check and the write aren't
 * atomic, so changing to a handle someone else claims in the same instant
 * can pass Rule::unique() and still hit the index on write. Reproduced
 * the same way RegistrationTest's version of this race is — at the exact
 * gap, via a model event.
 */
class ProfileControllerTest extends TestCase
{
    use RefreshDatabase;

    private function account(string $email, string $username): User
    {
        return User::create([
            'name' => str($email)->before('@')->headline()->toString(),
            'email' => $email,
            'username' => $username,
            'password' => 'password123',
        ]);
    }

    public function test_updating_the_username_to_a_free_handle_succeeds(): void
    {
        $user = $this->account('first@example.com', 'first-handle');

        $this->actingAs($user)->patchJson('/api/profile', ['username' => 'new-handle'])
            ->assertOk()
            ->assertJson(['username' => 'new-handle']);
    }

    public function test_a_username_change_that_loses_the_race_fails_cleanly_instead_of_500ing(): void
    {
        $user = $this->account('racer@example.com', 'racer-original');
        $other = $this->account('other@example.com', 'other-original');

        $raced = false;

        // Fires inside this request's own $user->update() call — after
        // Rule::unique('users', 'username') already passed the handle as
        // free, but before this request's own row lands. Taking the
        // handle here reproduces exactly what a second, concurrent
        // profile update racing for the same handle would do.
        User::saving(function (User $model) use (&$raced, $other) {
            if ($raced || $model->username !== 'photo-finish') {
                return;
            }

            $raced = true;
            $other->forceFill(['username' => 'photo-finish'])->save();
        });

        // Without the fix this 500s: $user->update()'s own read-then-write
        // hits the unique index on username directly, unguarded.
        $this->actingAs($user)->patchJson('/api/profile', ['username' => 'photo-finish'])
            ->assertStatus(422)
            ->assertJsonValidationErrors('username');

        $this->assertTrue($raced);
        $this->assertSame('racer-original', $user->fresh()->username);
        $this->assertSame('photo-finish', $other->fresh()->username);
    }
}
