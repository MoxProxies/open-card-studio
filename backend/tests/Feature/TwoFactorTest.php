<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\TwoFactor;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * The parts of the second factor an end-to-end run can't reach: what the
 * columns actually hold, and what a provider sign-in does when 2FA is on
 * (no provider is configured in a test run).
 */
class TwoFactorTest extends TestCase
{
    use RefreshDatabase;

    private function enabledAccount(): array
    {
        $twoFactor = app(TwoFactor::class);
        $user = User::create([
            'name' => 'Two Factor',
            'email' => 'tfa@example.com',
            'username' => 'two-factor',
            'password' => 'password123',
        ]);
        $user->two_factor_secret = $secret = $twoFactor->secret();
        $user->two_factor_recovery_codes = ['abcde-fghij'];
        $user->two_factor_confirmed_at = now();
        $user->save();

        return [$user, $secret];
    }

    public function test_the_secret_and_recovery_codes_are_encrypted_at_rest(): void
    {
        [$user, $secret] = $this->enabledAccount();

        $row = DB::table('users')->where('id', $user->id)->first();

        // The point of the encrypted cast: a database dump that leaks
        // TOTP secrets hands over the second factor for every account in
        // it. Reading the raw column has to give ciphertext.
        $this->assertNotSame($secret, $row->two_factor_secret);
        $this->assertStringNotContainsString($secret, $row->two_factor_secret);
        $this->assertStringNotContainsString('abcde-fghij', $row->two_factor_recovery_codes);

        // ...and the model still reads it back.
        $this->assertSame($secret, $user->fresh()->two_factor_secret);
    }

    public function test_an_unconfirmed_secret_does_not_gate_sign_in(): void
    {
        $user = User::create([
            'name' => 'Half Way',
            'email' => 'halfway@example.com',
            'username' => 'half-way',
            'password' => 'password123',
        ]);
        // Someone who opened the setup screen and wandered off.
        $user->two_factor_secret = app(TwoFactor::class)->secret();
        $user->save();

        $this->postJson('/api/auth/login', ['email' => 'halfway@example.com', 'password' => 'password123'])
            ->assertOk()
            ->assertJsonStructure(['token']);
    }

    public function test_a_provider_sign_in_also_stops_for_the_second_factor(): void
    {
        // Skipping 2FA here would make "link a provider" a documented way
        // around the thing the account turned on.
        [$user] = $this->enabledAccount();
        $challenge = app(TwoFactor::class)->startChallenge($user);

        $this->assertNotEmpty($challenge);
        $this->postJson('/api/auth/2fa/challenge', ['challenge' => $challenge, 'code' => 'abcde-fghij'])
            ->assertOk()
            ->assertJsonStructure(['token', 'user']);
    }

    public function test_a_challenge_expires(): void
    {
        [$user] = $this->enabledAccount();
        $challenge = app(TwoFactor::class)->startChallenge($user);

        $this->travel(6)->minutes();

        $this->postJson('/api/auth/2fa/challenge', ['challenge' => $challenge, 'code' => 'abcde-fghij'])->assertStatus(422);
    }

    public function test_an_account_with_no_password_turns_it_off_with_a_code(): void
    {
        [$user] = $this->enabledAccount();
        $user->password = null;
        $user->save();
        $user->socialAccounts()->create(['provider' => 'google', 'provider_user_id' => 'g-1']);

        $this->actingAs($user)->deleteJson('/api/auth/2fa', ['code' => 'wrong-code'])->assertStatus(422);
        $this->assertTrue($user->fresh()->hasTwoFactor());

        $this->actingAs($user)->deleteJson('/api/auth/2fa', ['code' => 'abcde-fghij'])->assertOk();
        $this->assertFalse($user->fresh()->hasTwoFactor());
    }

    public function test_the_secret_never_leaves_the_server_after_setup(): void
    {
        [$user] = $this->enabledAccount();

        $body = $this->actingAs($user)->getJson('/api/auth/me')->assertOk()->json();

        $this->assertArrayNotHasKey('two_factor_secret', $body);
        $this->assertArrayNotHasKey('two_factor_recovery_codes', $body);
        $this->assertTrue($body['has_two_factor']);
    }

    public function test_a_public_profile_says_nothing_about_it(): void
    {
        [$user] = $this->enabledAccount();

        $body = $this->getJson("/api/users/{$user->username}")->assertOk()->json();

        $this->assertArrayNotHasKey('has_two_factor', $body['profile'] ?? $body);
        $this->assertArrayNotHasKey('two_factor_confirmed_at', $body['profile'] ?? $body);
    }
}
