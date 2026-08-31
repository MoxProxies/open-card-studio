<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\DeviceName;
use App\Support\SocialProviders;
use App\Support\TwoFactor;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;
use Illuminate\Validation\Rules\Password;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\PersonalAccessToken;

/**
 * Plain bearer-token auth via Sanctum's personal access tokens — no
 * cookies, no CSRF dance, the same three endpoints an iOS/Android client
 * would use. See routes/api.php for how the resulting token then gates
 * every other endpoint via the auth:sanctum middleware.
 */
class AuthController extends Controller
{
    /** Failed sign-ins tolerated per email+IP before refusing outright. */
    private const MAX_LOGIN_ATTEMPTS = 5;

    private const LOGIN_DECAY_SECONDS = 60;

    public function register(Request $request)
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'string', 'email', 'max:255', 'unique:users,email'],
            // Letters and numbers, not just a length: "12345678" passes a
            // bare min:8 and is among the first guesses any attacker
            // makes. Deliberately not `uncompromised()` — that calls out
            // to an external breach API on every registration, which
            // fails open when the network is down and makes signup depend
            // on a third party being reachable.
            'password' => ['required', 'string', Password::min(8)->letters()->numbers()],
            // Optional at signup: an account is usable immediately with a
            // generated handle, and the profile editor is where most people
            // will pick a real one.
            'username' => ['sometimes', 'string', ...ProfileController::USERNAME_RULES],
        ]);

        $user = User::create([
            'name' => $data['name'],
            'email' => $data['email'],
            'password' => Hash::make($data['password']),
            'username' => $data['username'] ?? static::generateUsername($data['name']),
        ]);

        // Best-effort — see EmailController::dispatchVerification for why
        // a mail outage must not fail the registration.
        EmailController::dispatchVerification($user);

        return response()->json([
            'user' => static::selfPayload($user),
            'token' => static::issueToken($user, $request),
        ], 201);
    }

    public function login(Request $request)
    {
        $data = $request->validate([
            'email' => ['required', 'string', 'email'],
            'password' => ['required', 'string'],
        ]);

        // Rate limited here rather than by middleware so that only *failed*
        // attempts count. Middleware counts every request, which punishes
        // someone signing in on their third device as if they were guessing
        // — and a successful password is not an attack signal. Keyed on
        // email+IP: keying on IP alone lets one attacker behind a NAT lock
        // out everyone sharing the address.
        $throttleKey = mb_strtolower($data['email']).'|'.$request->ip();

        if (RateLimiter::tooManyAttempts($throttleKey, self::MAX_LOGIN_ATTEMPTS)) {
            abort(429, 'Too many sign-in attempts. Try again in '.RateLimiter::availableIn($throttleKey).' seconds.');
        }

        $user = User::where('email', $data['email'])->first();

        // A social-only account has no password to check. Say so plainly
        // rather than "wrong credentials" — otherwise someone who signed
        // up with Google is stuck guessing at a password that was never
        // set. This leaks only that the address uses social sign-in, which
        // the provider button already implies.
        if ($user && ! $user->hasPassword()) {
            throw ValidationException::withMessages([
                'email' => ['This account signs in with '.($user->socialAccounts()->first()?->provider ?? 'a linked provider').'. Use that button instead.'],
            ]);
        }

        if (! $user || ! Hash::check($data['password'], $user->password)) {
            RateLimiter::hit($throttleKey, self::LOGIN_DECAY_SECONDS);

            throw ValidationException::withMessages([
                'email' => ['These credentials do not match our records.'],
            ]);
        }

        // Cleared on success: a correct password ends the streak rather
        // than leaving the account half-locked for the rest of the window.
        RateLimiter::clear($throttleKey);

        // With a second factor on, a correct password buys a challenge
        // rather than a token — see TwoFactorController. Deliberately
        // *after* the rate-limit clear above: the password was right, and
        // the code has its own attempt budget.
        if ($user->hasTwoFactor()) {
            return response()->json([
                'two_factor' => true,
                'challenge' => app(TwoFactor::class)->startChallenge($user),
            ]);
        }

        // Suspension deliberately *not* refused here. A suspended account
        // that can't sign in can't appeal either, and every endpoint that
        // matters still 403s (BlockSuspendedUsers) — this is
        // authentication succeeding and authorisation failing, which is
        // the honest shape of it. The account's moderation_state rides
        // along in the response so the client shows the suspension
        // screen instead of a working app.
        return response()->json([
            'user' => static::selfPayload($user),
            'token' => static::issueToken($user, $request),
        ]);
    }

    public function logout(Request $request)
    {
        $request->user()->currentAccessToken()->delete();

        return response()->json(['message' => 'Logged out.']);
    }

    /**
     * The account's own signed-in devices — one row per live token, so
     * "what is signed in as me right now" is answerable, and a session
     * you don't recognise can be ended on its own rather than by signing
     * every device out.
     *
     * The token itself is never returned (only its hash is stored, and a
     * list endpoint has no business handing one back anyway); the id is
     * what revoking takes.
     */
    public function sessions(Request $request)
    {
        $current = static::currentTokenId($request);

        return response()->json(
            $request->user()->tokens()->latest('last_used_at')->latest('created_at')->get()->map(fn ($token) => [
                'id' => $token->id,
                'device' => $token->name,
                'created_at' => $token->created_at,
                'last_used_at' => $token->last_used_at,
                'expires_at' => $token->expires_at,
                // So the UI can label one row "this device" and refuse to
                // silently sign you out of the tab you're looking at.
                'current' => $token->id === $current,
            ])
        );
    }

    /** Ends one session. Revoking the current one is allowed — it's just
     * a sign-out — but the client is told, so it can clear its own token
     * rather than carrying on with a dead one. */
    public function revokeSession(Request $request, int $id)
    {
        $token = $request->user()->tokens()->whereKey($id)->firstOrFail();
        $wasCurrent = $token->id === static::currentTokenId($request);
        $token->delete();

        return response()->json(['id' => $id, 'was_current' => $wasCurrent]);
    }

    /**
     * The id of the token the request came in on, or null when there
     * isn't one to speak of. Sanctum hands back a TransientToken — which
     * has no id at all, so reading `->id` on it is a fatal error, not a
     * null — whenever the user was resolved by something other than a
     * bearer token.
     */
    private static function currentTokenId(Request $request): ?int
    {
        $token = $request->user()->currentAccessToken();

        return $token instanceof PersonalAccessToken ? $token->getKey() : null;
    }

    /**
     * Every token this app issues comes from here, so they all get the
     * same device label and the same expiry. Sanctum's config expiration
     * would cover the expiry on its own, but writing `expires_at` means
     * the sessions list above can show a real date instead of one it
     * inferred from a config value that may since have changed.
     */
    public static function issueToken(User $user, Request $request): string
    {
        $ttl = (int) config('sanctum.expiration');

        return $user->createToken(DeviceName::from($request), ['*'], $ttl > 0 ? now()->addMinutes($ttl) : null)->plainTextToken;
    }

    /**
     * Revokes every token this account has, not just the current one —
     * what you want after losing a device or suspecting a compromise, and
     * the only way to end a session you're not currently holding.
     */
    public function logoutEverywhere(Request $request)
    {
        $count = $request->user()->tokens()->count();
        $request->user()->tokens()->delete();

        return response()->json(['message' => 'Signed out everywhere.', 'sessions_ended' => $count]);
    }

    /** Which providers this deployment offers, so the sign-in UI knows
     * which buttons to draw. Public — it's asked before signing in. */
    public function socialProviders()
    {
        return response()->json(SocialProviders::forClient());
    }

    public function me(Request $request)
    {
        return response()->json(static::selfPayload($request->user()));
    }

    /**
     * What an account is told about itself: its own record, plus the two
     * computed flags a client needs to draw the right controls.
     *
     * User::$hidden drops `email` so it can never leak through a public
     * profile (see User::toPublicProfile); register/login/me — and the
     * 2FA challenge, which completes a sign-in — are the account talking
     * to itself about itself, so it comes back here.
     */
    public static function selfPayload(User $user): array
    {
        // An array rather than the model: `has_password` is computed, and
        // appending it to the model would follow it into every other
        // place a User gets serialized — including relations loaded
        // without the password column, where it would answer "no"
        // incorrectly.
        return $user->makeVisible('email')->toArray() + [
            'has_password' => $user->hasPassword(),
            'has_two_factor' => $user->hasTwoFactor(),
            'notification_emails' => (bool) $user->notification_emails,
        ];
    }

    /** A free, URL-safe handle derived from the display name — `ada-lovelace`,
     * `ada-lovelace-2`, ... Only used when the client didn't pick one. */
    public static function generateUsername(string $name): string
    {
        $base = Str::limit(Str::slug($name, '-'), 24, '') ?: 'user';
        $candidate = $base;

        for ($suffix = 2; User::where('username', $candidate)->exists(); $suffix++) {
            $candidate = $base.'-'.$suffix;
        }

        return $candidate;
    }
}
