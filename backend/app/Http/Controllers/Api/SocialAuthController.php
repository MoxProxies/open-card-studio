<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\SocialAccount;
use App\Models\User;
use App\Support\SocialProviders;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Socialite\Contracts\User as ProviderUser;
use Laravel\Socialite\Facades\Socialite;

/**
 * Sign in with Google or GitHub, for a bearer-token API with no session.
 *
 * The flow:
 *   1. The app calls `start` and gets back the provider's URL.
 *   2. The provider sends the browser to `callback`.
 *   3. `callback` finds or creates the account, mints a Sanctum token,
 *      and redirects to the app with the token in the URL *fragment*.
 *
 * Four things here are load-bearing for security, and each is easy to get
 * subtly wrong:
 *
 * - **The return URL is allowlisted** (config `frontend_urls`). An
 *   unchecked one turns this callback into an open redirect that hands a
 *   valid token to whatever host an attacker names.
 * - **The token comes back in the fragment, not the query.** A fragment
 *   isn't sent to servers and doesn't end up in access logs or a Referer.
 * - **State is a single-use server-side nonce.** Socialite's own state
 *   lives in the session, and this API has none, so `stateless()` is
 *   required — which means CSRF protection has to be replaced, not
 *   dropped. The nonce also carries the return URL, so that can't be
 *   tampered with in flight either.
 * - **An existing account is only linked by email when the provider
 *   verified it.** Otherwise anyone who can set an unverified address at
 *   a provider could sign in as that user here.
 */
class SocialAuthController extends Controller
{
    /** How long a sign-in may take between leaving and coming back. */
    private const STATE_TTL_SECONDS = 600;

    /** The providers this deployment offers — the app asks before drawing buttons. */
    public function providers()
    {
        return response()->json(SocialProviders::forClient());
    }

    /**
     * Returns the provider URL to send the browser to. JSON rather than a
     * 302 so the caller can decide how to navigate (a redirect, a popup)
     * and so an error is readable instead of a mystery bounce.
     */
    public function start(Request $request, string $provider)
    {
        $this->assertEnabled($provider);

        $data = $request->validate(['redirect_uri' => ['sometimes', 'string', 'max:2048']]);
        $returnTo = $this->resolveReturnUrl($data['redirect_uri'] ?? null);

        // The nonce is the CSRF defence: it exists only server-side, is
        // single-use, and expires. Carrying the return URL with it means
        // the URL can't be swapped in flight either.
        $nonce = Str::random(40);
        Cache::put($this->stateKey($nonce), $returnTo, self::STATE_TTL_SECONDS);

        return response()->json([
            'url' => Socialite::driver($provider)->stateless()->with(['state' => $nonce])->redirect()->getTargetUrl(),
        ]);
    }

    public function callback(Request $request, string $provider)
    {
        $this->assertEnabled($provider);

        $nonce = (string) $request->query('state', '');
        $returnTo = $nonce ? Cache::pull($this->stateKey($nonce)) : null;

        // Pulled, not read: a state is good for exactly one callback, so a
        // replayed URL can't mint a second token.
        abort_if($returnTo === null, 400, 'That sign-in link has expired or has already been used. Please try again.');

        // The provider reporting an error (a denied consent screen) is a
        // normal outcome, not an exception — send the user back with a
        // reason rather than a 500.
        if ($request->query('error')) {
            return redirect()->away($returnTo.'#error='.urlencode((string) $request->query('error')));
        }

        try {
            $providerUser = Socialite::driver($provider)->stateless()->user();
        } catch (\Throwable $e) {
            report($e);

            return redirect()->away($returnTo.'#error=provider_failed');
        }

        try {
            $user = $this->resolveUser($provider, $providerUser);
        } catch (AccountLinkConflict $e) {
            return redirect()->away($returnTo.'#error='.$e->getMessage());
        }

        abort_if($user->moderation_state === User::SUSPENDED, 403, 'This account is suspended.');

        return redirect()->away($returnTo.'#token='.urlencode($user->createToken('api')->plainTextToken));
    }

    /**
     * Find the account this provider identity belongs to, or make one.
     *
     * Order matters: the link is looked up by provider id first, because
     * that's the stable identity. Email is only a *fallback* for the first
     * sign-in, and only when the provider verified it.
     */
    private function resolveUser(string $provider, ProviderUser $providerUser): User
    {
        $providerId = (string) $providerUser->getId();
        $email = $providerUser->getEmail();

        $existing = SocialAccount::where('provider', $provider)->where('provider_user_id', $providerId)->first();

        if ($existing) {
            $existing->update(['email' => $email, 'avatar' => $providerUser->getAvatar(), 'last_used_at' => now()]);

            return $existing->user;
        }

        return DB::transaction(function () use ($provider, $providerUser, $providerId, $email) {
            $user = $email ? User::where('email', $email)->first() : null;

            if ($user && ! $this->emailIsVerified($provider, $providerUser)) {
                // The provider knows this address but won't vouch for it.
                // Linking here would be an account takeover, so refuse and
                // tell them to sign in the way they already can.
                throw new AccountLinkConflict('email_unverified');
            }

            $user ??= $this->createFromProvider($providerUser, $email);

            $user->socialAccounts()->create([
                'provider' => $provider,
                'provider_user_id' => $providerId,
                'email' => $email,
                'avatar' => $providerUser->getAvatar(),
                'last_used_at' => now(),
            ]);

            return $user;
        });
    }

    private function createFromProvider(ProviderUser $providerUser, ?string $email): User
    {
        $name = $providerUser->getName() ?: ($providerUser->getNickname() ?: 'New member');

        $user = new User([
            'name' => $name,
            'email' => $email ?: Str::uuid().'@social.invalid',
            'username' => AuthController::generateUsername($name),
        ]);

        // No password: this account signs in through its provider. See
        // User::hasPassword and AuthController::login.
        $user->password = null;
        // Reaching here means the provider vouched for the address (the
        // caller refuses to link an unverified one), so there's nothing
        // for our own verification email to add.
        $user->email_verified_at = $email ? now() : null;
        $user->save();

        return $user;
    }

    /**
     * Whether the provider says it verified the address.
     *
     * Google puts `email_verified` in the profile. GitHub's user API only
     * ever returns a *primary, verified* address as `email`, so a present
     * address is a verified one. A provider not handled here is treated as
     * unverified, which is the safe default.
     */
    private function emailIsVerified(string $provider, ProviderUser $providerUser): bool
    {
        $raw = $providerUser->getRaw();

        return match ($provider) {
            'google' => (bool) ($raw['email_verified'] ?? $raw['verified_email'] ?? false),
            'github' => (bool) $providerUser->getEmail(),
            default => false,
        };
    }

    /**
     * The app URL to hand the token back to — allowlisted, because an
     * unchecked redirect target here leaks a valid session to anywhere.
     */
    private function resolveReturnUrl(?string $requested): string
    {
        $allowed = collect(config('frontend_urls'))->map(fn ($url) => rtrim((string) $url, '/'))->filter()->values();

        abort_if($allowed->isEmpty(), 500, 'No FRONTEND_URLS are configured, so there is nowhere safe to return to.');

        if ($requested === null) {
            return $allowed->first();
        }

        $requested = rtrim($requested, '/');

        // Exact-match against the allowlist, not a prefix or a host
        // comparison: "https://evil.com/?x=https://app.example.com" and
        // "https://app.example.com.evil.com" both defeat the sloppier
        // versions of this check.
        abort_unless($allowed->contains($requested), 422, 'That redirect_uri is not an allowed frontend URL.');

        return $requested;
    }

    private function assertEnabled(string $provider): void
    {
        abort_unless(SocialProviders::isEnabled($provider), 404);
    }

    private function stateKey(string $nonce): string
    {
        return "social-auth-state:{$nonce}";
    }
}

/** Internal signal — a provider identity that can't be safely linked. */
class AccountLinkConflict extends \RuntimeException {}
