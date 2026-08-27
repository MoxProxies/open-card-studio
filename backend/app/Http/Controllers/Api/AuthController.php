<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
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
            'password' => ['required', 'string', 'min:8'],
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

        if (! $user || ! Hash::check($data['password'], $user->password)) {
            throw ValidationException::withMessages([
                'email' => ['These credentials do not match our records.'],
            ]);
        }

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
    private static function generateUsername(string $name): string
    {
        $base = Str::limit(Str::slug($name, '-'), 24, '') ?: 'user';
        $candidate = $base;

        for ($suffix = 2; User::where('username', $candidate)->exists(); $suffix++) {
            $candidate = $base.'-'.$suffix;
        }

        return $candidate;
    }
}
