<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\DeviceName;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * Token lifetime, which no end-to-end run can prove: the whole point of
 * an expiry is that it happens thirty days later, and a suite that waited
 * for that wouldn't be a suite. Time travel is the only honest way to
 * assert it, so it lives here rather than in tests/e2e.
 */
class SessionTest extends TestCase
{
    use RefreshDatabase;

    private function account(): User
    {
        return User::create([
            'name' => 'Tok En',
            'email' => 'tok@example.com',
            'password' => 'password123',
            'username' => 'tok-en',
        ]);
    }

    /**
     * One authenticated request per test, deliberately. The test HTTP
     * client keeps the guard's resolved user between calls inside a
     * single test, so a "works now / fails after travelling" pair in one
     * method passes on the cached identity and proves nothing.
     */
    public function test_a_token_works_before_it_expires(): void
    {
        $token = $this->account()->createToken('Chrome on macOS', ['*'], now()->addMinutes(30))->plainTextToken;

        $this->travel(29)->minutes();

        $this->withToken($token)->getJson('/api/auth/me')->assertOk();
    }

    public function test_a_token_stops_working_once_it_expires(): void
    {
        $token = $this->account()->createToken('Chrome on macOS', ['*'], now()->addMinutes(30))->plainTextToken;

        $this->travel(31)->minutes();

        $this->withToken($token)->getJson('/api/auth/me')->assertUnauthorized();
    }

    public function test_the_configured_ttl_expires_tokens_that_carry_no_expiry_of_their_own(): void
    {
        // Belt and braces: config('sanctum.expiration') covers tokens
        // issued before per-token expiry existed, and would cover a code
        // path that forgot to pass one.
        config(['sanctum.expiration' => 60]);
        $token = $this->account()->createToken('Chrome on macOS')->plainTextToken;

        $this->travel(61)->minutes();

        $this->withToken($token)->getJson('/api/auth/me')->assertUnauthorized();
    }

    public function test_registering_issues_a_token_that_expires(): void
    {
        $response = $this->postJson('/api/auth/register', [
            'name' => 'New Comer',
            'email' => 'new@example.com',
            'password' => 'password123',
        ])->assertCreated();

        $this->travel((int) config('sanctum.expiration') + 1)->minutes();

        $this->withToken($response->json('token'))->getJson('/api/auth/me')->assertUnauthorized();
    }

    public function test_a_token_is_named_for_the_device_that_asked_for_it(): void
    {
        $this->withHeader('User-Agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1')
            ->postJson('/api/auth/register', [
                'name' => 'Phone Owner',
                'email' => 'phone@example.com',
                'password' => 'password123',
            ])->assertCreated();

        $this->assertDatabaseHas('personal_access_tokens', ['name' => 'Safari on iPhone']);
    }

    public function test_the_sessions_list_never_returns_a_token_value(): void
    {
        $user = $this->account();
        $user->createToken('Safari on iPhone');

        $body = $this->actingAs($user)->getJson('/api/auth/sessions')->assertOk()->json();

        $this->assertNotEmpty($body);
        foreach ($body as $session) {
            $this->assertSame(['id', 'device', 'created_at', 'last_used_at', 'expires_at', 'current'], array_keys($session));
        }
    }

    public function test_one_account_cannot_revoke_another_accounts_session(): void
    {
        $victim = $this->account();
        $victimToken = $victim->createToken('Chrome on Windows');

        $attacker = User::create([
            'name' => 'At Tacker',
            'email' => 'attacker@example.com',
            'password' => 'password123',
            'username' => 'at-tacker',
        ]);

        $this->actingAs($attacker)
            ->deleteJson('/api/auth/sessions/'.$victimToken->accessToken->id)
            ->assertNotFound();

        $this->assertDatabaseHas('personal_access_tokens', ['id' => $victimToken->accessToken->id]);
    }

    #[DataProvider('deviceAgents')]
    public function test_it_labels_a_device_from_its_user_agent(string $agent, string $expected): void
    {
        $request = Request::create('/', 'GET', server: ['HTTP_USER_AGENT' => $agent]);

        $this->assertSame($expected, DeviceName::from($request));
    }

    public static function deviceAgents(): array
    {
        return [
            'chrome on mac' => ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36', 'Chrome on macOS'],
            // Edge and Opera both also say "Chrome"; the specific name has
            // to win, which is what the ordering in DeviceName is for.
            'edge on windows' => ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36 Edg/120.0', 'Edge on Windows'],
            'safari on iphone' => ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1 Version/17.0 Mobile/15E148 Safari/604.1', 'Safari on iPhone'],
            'firefox on linux' => ['Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0', 'Firefox on Linux'],
            'a bare script' => ['curl/8.4.0', 'Unknown device'],
            'nothing at all' => ['', 'Unknown device'],
        ];
    }
}
