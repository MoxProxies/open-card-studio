<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\ProfileController;
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

    /**
     * ProfileController already refuses a reserved handle on profile
     * *update* — register() must apply the same list, or self-registering
     * as "admin" is one signup form away, unique constraint notwithstanding.
     */
    public function test_registering_with_a_reserved_username_is_rejected(): void
    {
        $this->postJson('/api/auth/register', [
            'name' => 'Someone',
            'email' => 'someone@example.com',
            'password' => 'password123',
            'username' => ProfileController::RESERVED_USERNAMES[0],
        ])->assertStatus(422)->assertJsonValidationErrors('username');

        $this->assertDatabaseCount('users', 0);
    }

    /**
     * The email counterpart to the username race below: two registrations
     * for the same address landing at the same instant. Unlike the
     * username race, there's nothing to retry onto — the email really is
     * taken now — so this just has to fail cleanly instead of 500ing.
     */
    public function test_registering_an_email_that_loses_the_race_fails_cleanly_instead_of_500ing(): void
    {
        $raced = false;

        // Fires inside this request's own User::create() call — after
        // 'unique:users,email' validation already passed the address as
        // free, but before that row exists. Creating it here reproduces
        // exactly what a second, concurrent registration for the same
        // address would do.
        User::creating(function (User $user) use (&$raced) {
            if ($raced || $user->email !== 'photo-finish@example.com') {
                return;
            }

            $raced = true;
            User::create([
                'name' => 'Other Runner',
                'email' => 'photo-finish@example.com',
                'username' => 'other-photo-finish',
                'password' => 'password123',
            ]);
        });

        // Without the fix this 500s: AuthController::saveWithUniqueUsername()
        // only retries past a *username* collision and rethrows anything
        // else, so the email race blows straight through it.
        $this->postJson('/api/auth/register', [
            'name' => 'Photo Finish',
            'email' => 'photo-finish@example.com',
            'password' => 'password123',
        ])->assertStatus(422)->assertJsonValidationErrors('email');

        $this->assertTrue($raced);
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

    /**
     * The explicit-username check above (Rule::notIn) never runs when no
     * username is submitted at all — generateUsername() has to refuse the
     * reserved word on its own, or signing up as "Admin" with a blank
     * username field is a way around the very check this class already
     * tests for the explicit-username path.
     */
    public function test_a_blank_username_never_generates_a_reserved_handle(): void
    {
        $reserved = ProfileController::RESERVED_USERNAMES[0];

        $response = $this->postJson('/api/auth/register', [
            'name' => ucfirst($reserved),
            'email' => 'generated-reserved@example.com',
            'password' => 'password123',
        ])->assertCreated();

        $username = $response->json('user.username');
        $this->assertNotContains($username, ProfileController::RESERVED_USERNAMES);
        $this->assertSame($reserved.'-2', $username);
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
