<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\Request;
use App\Support\SocialProviders;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Validation\Rules\Password;
use Illuminate\Validation\ValidationException;

/**
 * Plain bearer-token auth via Sanctum's personal access tokens — no
 * cookies, no CSRF dance, the same three endpoints an iOS/Android client
 * would use. See routes/api.php for how the resulting token then gates
 * every other endpoint via the auth:sanctum middleware.
 */
class AuthController extends Controller
{
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

        return response()->json([
            'user' => static::withEmail($user),
            'token' => $user->createToken('api')->plainTextToken,
        ], 201);
    }

    public function login(Request $request)
    {
        $data = $request->validate([
            'email' => ['required', 'string', 'email'],
            'password' => ['required', 'string'],
        ]);

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
            throw ValidationException::withMessages([
                'email' => ['These credentials do not match our records.'],
            ]);
        }

        abort_if($user->moderation_state === User::SUSPENDED, 403, 'This account is suspended.');

        return response()->json([
            'user' => static::withEmail($user),
            'token' => $user->createToken('api')->plainTextToken,
        ]);
    }

    public function logout(Request $request)
    {
        $request->user()->currentAccessToken()->delete();

        return response()->json(['message' => 'Logged out.']);
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
        return response()->json(static::withEmail($request->user()));
    }

    /**
     * User::$hidden drops `email` so it can never leak through a public
     * profile (see User::toPublicProfile). These three endpoints are the
     * account talking to itself about itself, so it comes back here.
     */
    private static function withEmail(User $user): User
    {
        return $user->makeVisible('email');
    }

    /** `is_staff` rides along on the account's own record so the client can
     * show the moderation destination — it's already in the model's
     * attributes, and is never part of a public profile. */

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
