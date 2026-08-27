<?php

namespace Tests\Feature;

use App\Models\SocialAccount;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\Cache;
use Laravel\Socialite\Contracts\Provider;
use Laravel\Socialite\Facades\Socialite;
use Laravel\Socialite\Two\User as SocialiteUser;
use Mockery;
use Tests\TestCase;

/**
 * The parts of social sign-in that a real provider round-trip can't be
 * asked to prove on every run: which account a provider identity resolves
 * to, and the four checks protecting the handoff.
 *
 * The linking rules are the account-takeover surface — get "match on
 * email" wrong and signing in with a provider hands you somebody else's
 * account — so they're tested against a mocked provider rather than left
 * to a manual click-through.
 */
class SocialAuthTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        config([
            'services.google.client_id' => 'test-client-id',
            'services.google.client_secret' => 'test-secret',
            'services.google.redirect' => 'http://localhost:8000/api/auth/google/callback',
            'frontend_urls' => ['http://localhost:4173'],
        ]);
    }

    /** Stands in for the provider handing back a profile. */
    private function fakeProviderUser(array $raw = [], ?string $email = 'someone@example.com', string $id = 'provider-123'): void
    {
        $user = (new SocialiteUser)->setRaw($raw + ['email_verified' => true]);
        $user->id = $id;
        $user->name = 'Provider Person';
        $user->email = $email;
        $user->avatar = 'https://example.com/a.png';

        // Covers both halves of the flow: redirect() for start(), user()
        // for callback().
        $provider = Mockery::mock(Provider::class);
        $provider->shouldReceive('stateless')->andReturnSelf();
        $provider->shouldReceive('with')->andReturnSelf();
        $provider->shouldReceive('redirect')->andReturn(
            new RedirectResponse('https://accounts.google.com/o/oauth2/auth?client_id=test-client-id&state=nonce')
        );
        $provider->shouldReceive('user')->andReturn($user);

        Socialite::shouldReceive('driver')->with('google')->andReturn($provider);
    }

    /** Starts a sign-in and returns the state nonce the callback needs. */
    private function startAndGetState(): string
    {
        $this->postJson('/api/auth/google/start', ['redirect_uri' => 'http://localhost:4173'])->assertOk();

        return $this->lastStateNonce();
    }

    private function lastStateNonce(): string
    {
        // The array cache store exposes its keys, which is enough to find
        // the nonce without weakening the controller's design by returning
        // it to the client.
        $keys = array_keys((fn () => $this->storage)->call(Cache::getStore()));
        $stateKeys = array_values(array_filter($keys, fn ($k) => str_starts_with($k, 'social-auth-state:')));

        $this->assertNotEmpty($stateKeys, 'start() should have stored a state nonce');

        return str_replace('social-auth-state:', '', end($stateKeys));
    }

    public function test_only_configured_providers_are_offered(): void
    {
        $this->getJson('/api/auth/providers')->assertOk()->assertJson([['id' => 'google', 'label' => 'Google']]);

        config(['services.google.client_id' => null, 'services.github.client_id' => null]);

        $this->getJson('/api/auth/providers')->assertOk()->assertExactJson([]);
        $this->postJson('/api/auth/google/start')->assertNotFound();
        $this->get('/api/auth/google/callback')->assertNotFound();
    }

    public function test_start_returns_the_provider_url(): void
    {
        $response = $this->postJson('/api/auth/google/start', ['redirect_uri' => 'http://localhost:4173'])->assertOk();

        $url = $response->json('url');
        $this->assertStringContainsString('accounts.google.com', $url);
        $this->assertStringContainsString('test-client-id', $url);
        $this->assertStringContainsString('state=', $url);
    }

    public function test_a_return_url_outside_the_allowlist_is_refused(): void
    {
        // The open-redirect check. Each of these defeats a sloppier
        // version of it — a prefix match, a host `str_contains`, a
        // trailing-slash slip.
        foreach ([
            'https://evil.example',
            'http://localhost:4173.evil.example',
            'https://evil.example/?next=http://localhost:4173',
            'http://localhost:4173/../../evil',
        ] as $bad) {
            $this->postJson('/api/auth/google/start', ['redirect_uri' => $bad])
                ->assertStatus(422);
        }

        $this->postJson('/api/auth/google/start', ['redirect_uri' => 'http://localhost:4173'])->assertOk();
    }

    public function test_the_callback_requires_an_unused_state(): void
    {
        $this->fakeProviderUser();

        $this->get('/api/auth/google/callback')->assertStatus(400);
        $this->get('/api/auth/google/callback?state=never-issued')->assertStatus(400);

        $state = $this->startAndGetState();
        $this->get("/api/auth/google/callback?state={$state}")->assertRedirect();

        // Replaying the same callback URL must not mint a second token.
        $this->get("/api/auth/google/callback?state={$state}")->assertStatus(400);
    }

    public function test_the_token_comes_back_in_the_fragment(): void
    {
        $this->fakeProviderUser();
        $state = $this->startAndGetState();

        $location = $this->get("/api/auth/google/callback?state={$state}")->headers->get('Location');

        // A fragment isn't sent to servers and doesn't reach access logs
        // or a Referer header; a query parameter would be in both.
        $this->assertStringStartsWith('http://localhost:4173#token=', $location);
        $this->assertStringNotContainsString('?token=', $location);
    }

    public function test_a_first_sign_in_creates_an_account_with_no_password(): void
    {
        $this->fakeProviderUser(email: 'newcomer@example.com');
        $state = $this->startAndGetState();

        $this->get("/api/auth/google/callback?state={$state}")->assertRedirect();

        $user = User::where('email', 'newcomer@example.com')->firstOrFail();
        $this->assertNull($user->password, 'a social-only account should have no password');
        $this->assertNotNull($user->email_verified_at, 'a provider-verified address needs no second verification');
        $this->assertNotNull($user->username);
        $this->assertDatabaseHas('social_accounts', ['user_id' => $user->id, 'provider' => 'google', 'provider_user_id' => 'provider-123']);
    }

    public function test_signing_in_again_reuses_the_same_account(): void
    {
        $this->fakeProviderUser(email: 'repeat@example.com');

        $first = $this->startAndGetState();
        $this->get("/api/auth/google/callback?state={$first}");
        $second = $this->startAndGetState();
        $this->get("/api/auth/google/callback?state={$second}");

        $this->assertSame(1, User::where('email', 'repeat@example.com')->count());
        $this->assertSame(1, SocialAccount::where('provider_user_id', 'provider-123')->count());
    }

    public function test_a_verified_provider_email_links_to_the_existing_account(): void
    {
        $existing = User::create([
            'name' => 'Already Here',
            'email' => 'existing@example.com',
            'username' => 'already-here',
            'password' => bcrypt('password123'),
        ]);

        $this->fakeProviderUser(['email_verified' => true], email: 'existing@example.com');
        $state = $this->startAndGetState();

        $this->get("/api/auth/google/callback?state={$state}")->assertRedirect();

        $this->assertSame(1, User::where('email', 'existing@example.com')->count());
        $this->assertDatabaseHas('social_accounts', ['user_id' => $existing->id, 'provider' => 'google']);
    }

    public function test_an_unverified_provider_email_is_refused_rather_than_linked(): void
    {
        // The account-takeover case: a provider that won't vouch for the
        // address must never be enough to claim an existing account.
        $existing = User::create([
            'name' => 'Victim',
            'email' => 'victim@example.com',
            'username' => 'victim',
            'password' => bcrypt('password123'),
        ]);

        $this->fakeProviderUser(['email_verified' => false], email: 'victim@example.com');
        $state = $this->startAndGetState();

        $location = $this->get("/api/auth/google/callback?state={$state}")->headers->get('Location');

        $this->assertStringContainsString('#error=email_unverified', $location);
        $this->assertStringNotContainsString('token=', $location);
        $this->assertSame(0, SocialAccount::where('user_id', $existing->id)->count());
    }

    /**
     * Signing in while suspended is allowed on purpose — an account that
     * can't sign in can't appeal either — so what has to hold is that the
     * token it gets opens nothing. See BlockSuspendedUsers and
     * AppealController.
     */
    public function test_a_suspended_account_signs_in_through_a_provider_but_gets_a_token_that_opens_nothing(): void
    {
        $user = User::create([
            'name' => 'Banned',
            'email' => 'banned@example.com',
            'username' => 'banned',
            'password' => bcrypt('password123'),
        ]);
        $user->moderation_state = User::SUSPENDED;
        $user->save();

        $this->fakeProviderUser(email: 'banned@example.com');
        $state = $this->startAndGetState();

        $location = $this->get("/api/auth/google/callback?state={$state}")->headers->get('Location');

        $this->assertStringContainsString('#token=', $location);

        $token = urldecode(str($location)->after('#token=')->toString());

        $this->withToken($token)->getJson('/api/auth/me')
            ->assertForbidden()
            ->assertJson(['suspended' => true]);
    }

    public function test_a_suspended_account_can_still_file_an_appeal(): void
    {
        $user = User::create([
            'name' => 'Banned',
            'email' => 'banned2@example.com',
            'username' => 'banned2',
            'password' => bcrypt('password123'),
        ]);
        $user->moderation_state = User::SUSPENDED;
        $user->save();

        $this->actingAs($user)
            ->postJson('/api/auth/appeal', ['message' => 'This was a misunderstanding and here is why.'])
            ->assertCreated()
            ->assertJson(['state' => 'open']);
    }

    public function test_a_denied_consent_screen_comes_back_as_an_error_not_a_crash(): void
    {
        $this->fakeProviderUser();
        $state = $this->startAndGetState();

        $location = $this->get("/api/auth/google/callback?state={$state}&error=access_denied")->headers->get('Location');

        $this->assertStringContainsString('#error=access_denied', $location);
    }

    protected function tearDown(): void
    {
        Mockery::close();
        parent::tearDown();
    }
}
