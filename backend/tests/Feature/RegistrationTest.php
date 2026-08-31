<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The username-collision paths a normal registration never reaches:
 * an explicit choice that's already taken, and a generated handle that
 * loses a race to a concurrent request. Neither can be proven through a
 * real thread race in a test, so the second is simulated at the one
 * point that matters — the gap between generateUsername()'s exists()
 * check and this request's own row actually landing — by having
 * something else take the name in that exact gap.
 */
class RegistrationTest extends TestCase
{
    use RefreshDatabase;

    public function test_registering_with_an_already_taken_username_fails_cleanly_instead_of_500ing(): void
    {
        User::create(['name' => 'First', 'email' => 'first@example.com', 'username' => 'taken', 'password' => 'password123']);

        $this->postJson('/api/auth/register', [
            'name' => 'Second',
            'email' => 'second@example.com',
            'password' => 'password123',
            'username' => 'taken',
        ])->assertStatus(422)->assertJsonValidationErrors('username');

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
