<?php

namespace Tests\Feature;

use App\Models\User;
use App\Notifications\ResetPassword;
use App\Notifications\VerifyEmail;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Password;
use Tests\TestCase;

/**
 * The two transactional emails. Delivery through Brevo isn't tested here
 * — that needs real credentials — but everything up to handing the
 * message to the mailer is, including the parts that would be security
 * bugs if they were wrong: the membership oracle, link tampering, and
 * what a reset does to existing sessions.
 */
class TransactionalEmailTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['frontend_urls' => ['http://localhost:4173']]);
    }

    private function register(string $email = 'newcomer@example.com'): User
    {
        $this->postJson('/api/auth/register', [
            'name' => 'New Comer',
            'email' => $email,
            'password' => 'password123',
        ])->assertCreated();

        return User::where('email', $email)->firstOrFail();
    }

    public function test_registering_sends_a_confirmation_email(): void
    {
        Notification::fake();

        $user = $this->register();

        Notification::assertSentTo($user, VerifyEmail::class);
        $this->assertNull($user->email_verified_at);
    }

    public function test_a_mail_outage_does_not_break_registration(): void
    {
        // The provider being down must not turn a working signup into a
        // 500 — the account is recoverable, a failed registration isn't.
        Notification::fake();
        Notification::shouldReceive('send')->andThrow(new \RuntimeException('smtp is down'));

        $this->postJson('/api/auth/register', [
            'name' => 'Unlucky Timing',
            'email' => 'unlucky@example.com',
            'password' => 'password123',
        ])->assertCreated();

        $this->assertDatabaseHas('users', ['email' => 'unlucky@example.com']);
    }

    public function test_the_confirmation_link_verifies_the_address(): void
    {
        Notification::fake();
        $user = $this->register();

        $this->get(VerifyEmail::signedUrl($user))
            ->assertRedirect('http://localhost:4173/#verify=ok');

        $this->assertNotNull($user->fresh()->email_verified_at);
    }

    public function test_a_tampered_or_unsigned_confirmation_link_is_refused(): void
    {
        Notification::fake();
        $user = $this->register();
        $signed = VerifyEmail::signedUrl($user);

        // Unsigned entirely.
        $this->get("/api/auth/email/verify/{$user->id}/".sha1($user->email))->assertForbidden();
        // Signature kept, target swapped.
        $this->get(str_replace("/{$user->id}/", '/999/', $signed))->assertForbidden();

        $this->assertNull($user->fresh()->email_verified_at);
    }

    public function test_changing_the_address_kills_an_outstanding_link(): void
    {
        Notification::fake();
        $user = $this->register();
        $link = VerifyEmail::signedUrl($user);

        $user->forceFill(['email' => 'moved@example.com'])->save();

        // The old address is hashed into the link, so it can't be used to
        // confirm an address the user never proved they own.
        $this->get($link)->assertRedirect('http://localhost:4173/#verify=invalid');
        $this->assertNull($user->fresh()->email_verified_at);
    }

    public function test_forgot_password_answers_identically_whether_or_not_the_account_exists(): void
    {
        Notification::fake();
        $known = $this->register('known@example.com');

        $a = $this->postJson('/api/auth/password/forgot', ['email' => 'known@example.com'])->assertOk();
        $b = $this->postJson('/api/auth/password/forgot', ['email' => 'nobody@example.com'])->assertOk();

        // Identical bodies: anything else makes this a membership oracle.
        $this->assertSame($a->json(), $b->json());
        Notification::assertSentTo($known, ResetPassword::class);
        Notification::assertSentTimes(ResetPassword::class, 1);
    }

    public function test_a_social_only_account_gets_no_reset_mail_but_the_same_answer(): void
    {
        Notification::fake();
        $social = User::create(['name' => 'Google Only', 'email' => 'social@example.com', 'username' => 'google-only']);
        $social->password = null;
        $social->save();

        $this->postJson('/api/auth/password/forgot', ['email' => 'social@example.com'])
            ->assertOk()
            ->assertJson(['message' => "If that address has an account, we've sent a reset link."]);

        Notification::assertNothingSentTo($social);
    }

    public function test_resetting_changes_the_password_and_ends_every_session(): void
    {
        $user = $this->register('resetme@example.com');
        $token = Password::broker()->createToken($user);

        $user->createToken('api');

        $this->postJson('/api/auth/password/reset', [
            'token' => $token,
            'email' => 'resetme@example.com',
            'password' => 'brandnew123',
            'password_confirmation' => 'brandnew123',
        ])->assertOk();

        $this->assertTrue(Hash::check('brandnew123', $user->fresh()->password));

        // Whoever held a session before the reset — including an attacker
        // it was performed because of — loses it. Asserted against the
        // table as well as over HTTP: the test client keeps a resolved
        // user around between calls in one test, so the HTTP check alone
        // would pass on a cached identity rather than a live token.
        // Asserted against the table, not over HTTP: the test client keeps
        // a resolved identity between calls within one test, so an HTTP
        // check here passes on a cached user rather than a live token. The
        // real 401 is covered end-to-end in tests/e2e/api/auth.sh, against
        // a running server where there's no such caching.
        $this->assertSame(0, $user->tokens()->count(), 'a reset should revoke every token');
    }

    public function test_a_reset_token_works_once(): void
    {
        $user = $this->register('once@example.com');
        $token = Password::broker()->createToken($user);
        $payload = [
            'token' => $token,
            'email' => 'once@example.com',
            'password' => 'brandnew123',
            'password_confirmation' => 'brandnew123',
        ];

        $this->postJson('/api/auth/password/reset', $payload)->assertOk();
        $this->postJson('/api/auth/password/reset', $payload)->assertStatus(422);
    }

    public function test_a_reset_obeys_the_same_password_rules_as_signup(): void
    {
        $user = $this->register('weak@example.com');
        $token = Password::broker()->createToken($user);

        foreach (['12345678', 'abcdefgh', 'ab1'] as $weak) {
            $this->postJson('/api/auth/password/reset', [
                'token' => $token,
                'email' => 'weak@example.com',
                'password' => $weak,
                'password_confirmation' => $weak,
            ])->assertStatus(422);
        }
    }

    public function test_the_reset_link_points_at_the_app_not_the_api(): void
    {
        $user = $this->register('linky@example.com');

        $mail = (new ResetPassword('the-token'))->toMail($user);
        $action = collect($mail->actionUrl)->first() ?? $mail->actionUrl;

        // The user has to type a new password, so the token has to land
        // somewhere that can render a form.
        $this->assertStringStartsWith('http://localhost:4173/#/reset-password?token=the-token', $action);
        $this->assertStringContainsString('email=linky%40example.com', $action);
    }

    public function test_confirmation_can_be_resent_and_is_a_no_op_once_verified(): void
    {
        Notification::fake();
        $user = $this->register('resend@example.com');

        $this->actingAs($user)->postJson('/api/auth/email/verify/send')
            ->assertOk()->assertJson(['message' => 'Confirmation email sent.']);

        $user->forceFill(['email_verified_at' => now()])->save();

        $this->actingAs($user->fresh())->postJson('/api/auth/email/verify/send')
            ->assertOk()->assertJson(['message' => 'That address is already confirmed.']);
    }
}
