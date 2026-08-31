<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The username-collision paths a normal registration never reaches: an
 * explicit choice that's already taken, and either kind of handle
 * (chosen or generated) losing a race to a concurrent request that
 * takes the name in the gap between this request's own uniqueness check
 * and its row actually landing. A real thread race isn't reliable to
 * trigger in a test, so it's simulated at that exact gap — inside the
 * request's own User::create() call — by having something else take the
 * name right there.
 */
class RegistrationTest extends TestCase
{
    use RefreshDatabase;

    public function test_registering_with_an_already_taken_username_fails_cleanly_instead_of_500ing(): void
    {
        User::create(['name' => 'First', 'email' => 'first@example.com', 'username' => 'taken', 'password' => 'password123']);

        // Caught by the 'unique:users,username' validation rule, not the
        // race-handling below — the name was already taken before this
        // request even started.
        $this->postJson('/api/auth/register', [
            'name' => 'Second',
            'email' => 'second@example.com',
            'password' => 'password123',
            'username' => 'taken',
        ])->assertStatus(422)->assertJsonValidationErrors('username');

        $this->assertDatabaseCount('users', 1);
    }

    public function test_a_requested_username_that_loses_the_race_fails_cleanly_instead_of_500ing(): void
    {
        $hijacked = false;

        // The validation rule above can only see usernames already taken
        // *before* this request started — it can't see one a concurrent
        // request takes while this one is still in flight. This fires
        // inside this request's own User::create() call, after
        // validation already passed the name as free, reproducing
        // exactly that race.
        User::creating(function (User $user) use (&$hijacked) {
            if ($hijacked || $user->username !== 'photo-finish') {
                return;
            }

            $hijacked = true;
            User::create([
                'name' => 'Other Runner',
                'email' => 'other-photo-finish@example.com',
                'username' => 'photo-finish',
                'password' => 'password123',
            ]);
        });

        $this->postJson('/api/auth/register', [
            'name' => 'Photo Finish',
            'email' => 'photo-finish@example.com',
            'password' => 'password123',
            'username' => 'photo-finish',
        ])->assertStatus(422)->assertJsonValidationErrors('username');

        $this->assertTrue($hijacked);
        $this->assertDatabaseCount('users', 1);
    }

    public function test_a_generated_username_that_loses_the_race_retries_onto_a_free_one(): void
    {
        $hijacked = false;

        // Fires inside the request's own User::create() call — after
        // generateUsername() has already decided "race-runner" is free,
        // but before that row exists. Taking the name here reproduces
        // exactly what a concurrent registration would do to it.
        User::creating(function (User $user) use (&$hijacked) {
            if ($hijacked || $user->username !== 'race-runner') {
                return;
            }

            $hijacked = true;
            User::create([
                'name' => 'Other Runner',
                'email' => 'other-racer@example.com',
                'username' => 'race-runner',
                'password' => 'password123',
            ]);
        });

        $response = $this->postJson('/api/auth/register', [
            'name' => 'Race Runner',
            'email' => 'racer@example.com',
            'password' => 'password123',
        ])->assertCreated();

        $this->assertTrue($hijacked);
        $this->assertSame('race-runner-2', $response->json('user.username'));
        $this->assertDatabaseCount('users', 2);
    }
}
