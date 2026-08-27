<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Notifications\ResetPassword;
use App\Notifications\VerifyEmail;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Str;
use Illuminate\Validation\Rules\Password as PasswordRule;

/**
 * Email confirmation and password reset — the two transactional emails.
 *
 * Both are shaped around this being a token API the frontend drives.
 * Verification links back to the API (a signed URL Laravel checks itself,
 * so clicking is the whole interaction); reset links to the app, because
 * someone has to type a new password somewhere.
 *
 * Two rules run through all of it:
 *
 * - **Never confirm or deny that an address has an account.** "If that
 *   address has an account, we've sent a link" is the same response
 *   either way; anything else turns this into a membership oracle.
 * - **A mail outage must not break the app.** Sending is best-effort at
 *   signup and logged when it fails — an account that exists but hasn't
 *   had its email confirmed is recoverable; a signup that 500s is not.
 */
class EmailController extends Controller
{
    /** Sends (or re-sends) the confirmation email to the signed-in account. */
    public function sendVerification(Request $request)
    {
        $user = $request->user();

        if ($user->email_verified_at) {
            return response()->json(['message' => 'That address is already confirmed.']);
        }

        static::dispatchVerification($user);

        return response()->json(['message' => 'Confirmation email sent.']);
    }

    /**
     * The link target. Signed by Laravel, so no token of our own — and the
     * address is hashed into it, so the link dies if the address changes.
     */
    public function verify(Request $request, int $id, string $hash)
    {
        $frontend = rtrim((string) (config('frontend_urls')[0] ?? ''), '/');
        $user = User::find($id);

        if (! $user || ! hash_equals($hash, sha1($user->email))) {
            return redirect()->away($frontend.'/#verify=invalid');
        }

        if (! $user->email_verified_at) {
            $user->forceFill(['email_verified_at' => now()])->save();
        }

        return redirect()->away($frontend.'/#verify=ok');
    }

    /**
     * Starts a password reset. Always answers the same way — see this
     * class's doc comment on not leaking whether an address is registered.
     */
    public function forgotPassword(Request $request)
    {
        $data = $request->validate(['email' => ['required', 'string', 'email', 'max:255']]);

        $user = User::where('email', $data['email'])->first();

        // A social-only account has no password to reset. Still answered
        // identically — telling an anonymous caller "that address uses
        // Google" is the same leak in a different shape.
        if ($user && $user->hasPassword()) {
            $token = Password::broker()->createToken($user);
            $user->notify(new ResetPassword($token));
        }

        return response()->json(['message' => "If that address has an account, we've sent a reset link."]);
    }

    /** Finishes a reset with the token from the email. */
    public function resetPassword(Request $request)
    {
        $data = $request->validate([
            'token' => ['required', 'string'],
            'email' => ['required', 'string', 'email'],
            'password' => ['required', 'string', 'confirmed', PasswordRule::min(8)->letters()->numbers()],
        ]);

        $status = Password::broker()->reset($data, function (User $user, string $password) {
            $user->forceFill([
                'password' => Hash::make($password),
                'remember_token' => Str::random(60),
            ])->save();

            // Every existing session dies with the old password. Whoever
            // forced the reset — including an attacker who had the account
            // — loses their tokens; whoever legitimately reset it signs in
            // again with the new one.
            $user->tokens()->delete();
        });

        abort_unless(
            $status === Password::PASSWORD_RESET,
            422,
            'That reset link has expired or has already been used. Request a new one.',
        );

        return response()->json(['message' => 'Password changed. Sign in with your new password.']);
    }

    /**
     * Best-effort send. A provider outage shouldn't turn a working signup
     * into a 500 — the address stays unconfirmed and the email can be
     * re-requested, which is a far better failure than no account at all.
     */
    public static function dispatchVerification(User $user): void
    {
        try {
            $user->notify(new VerifyEmail);
        } catch (\Throwable $e) {
            report($e);
        }
    }
}
