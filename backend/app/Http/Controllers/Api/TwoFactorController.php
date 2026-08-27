<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Support\TwoFactor;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

/**
 * Turning the second factor on and off, and the challenge that stands
 * between a correct password and a token once it's on.
 *
 * Setup is deliberately two steps. `setup` mints a secret and shows it;
 * `confirm` only counts it as enabled once a code generated from it comes
 * back. Enabling in one step locks out anyone whose scan silently failed
 * or whose phone clock is wrong — the confirmation *is* the proof that
 * the thing they'll need at the next sign-in actually works.
 */
class TwoFactorController extends Controller
{
    public function __construct(private TwoFactor $twoFactor) {}

    /** A fresh secret and the URI an authenticator app scans. Not enabled
     * yet — see the class comment. */
    public function setup(Request $request)
    {
        $user = $request->user();

        abort_if($user->hasTwoFactor(), 422, 'Two-factor authentication is already on for this account.');

        // Overwrites any previous unconfirmed secret: someone who
        // abandoned the setup screen and came back should be scanning the
        // code in front of them, not one from last week.
        $user->two_factor_secret = $secret = $this->twoFactor->secret();
        $user->two_factor_confirmed_at = null;
        $user->save();

        return response()->json([
            'secret' => $secret,
            'otpauth_url' => $this->twoFactor->provisioningUri($user, $secret),
        ]);
    }

    /**
     * Proves the app is set up, and hands back the recovery codes — the
     * only time they're ever readable. They're stored hashed-in-spirit
     * (encrypted, see User::casts) and never returned again; regenerating
     * is the way back if they're lost.
     */
    public function confirm(Request $request)
    {
        $data = $request->validate(['code' => ['required', 'string', 'max:32']]);
        $user = $request->user();

        abort_if($user->hasTwoFactor(), 422, 'Two-factor authentication is already on for this account.');
        abort_if(! $user->two_factor_secret, 422, 'Start the setup first.');

        if (! $this->twoFactor->verifyCode($user, $data['code'])) {
            throw ValidationException::withMessages(['code' => ['That code is wrong or has expired. Check your phone\'s clock and try the next one.']]);
        }

        $user->two_factor_recovery_codes = $codes = $this->twoFactor->recoveryCodes();
        $user->two_factor_confirmed_at = now();
        $user->save();

        return response()->json(['recovery_codes' => $codes]);
    }

    /** New recovery codes, invalidating the old set. Re-authenticates for
     * the same reason deleting an account does: an unattended browser
     * shouldn't be able to print a fresh set of skeleton keys. */
    public function regenerate(Request $request)
    {
        $user = $this->reauthenticate($request);

        $user->two_factor_recovery_codes = $codes = $this->twoFactor->recoveryCodes();
        $user->save();

        return response()->json(['recovery_codes' => $codes]);
    }

    /** Turns it off. Same re-authentication: this is the step an attacker
     * with a borrowed session would want most. */
    public function disable(Request $request)
    {
        $user = $this->reauthenticate($request);

        $user->two_factor_secret = null;
        $user->two_factor_recovery_codes = null;
        $user->two_factor_confirmed_at = null;
        $user->save();

        return response()->json(['message' => 'Two-factor authentication is off.']);
    }

    /**
     * The second half of a sign-in: a challenge id from login (or from a
     * provider redirect) plus a code, in exchange for a token.
     *
     * Unauthenticated by definition — the caller has no token yet, which
     * is the whole point. What protects it is that the challenge is
     * server-side, single-use, expiring, and gives up after a handful of
     * wrong codes (see TwoFactor).
     */
    public function challenge(Request $request)
    {
        $data = $request->validate([
            'challenge' => ['required', 'string', 'max:128'],
            'code' => ['required', 'string', 'max:32'],
        ]);

        $user = $this->twoFactor->completeChallenge($data['challenge'], $data['code']);

        if (! $user) {
            // One message for a wrong code, an expired challenge and one
            // that ran out of attempts: which of those it was is
            // information an attacker can use to pace themselves.
            throw ValidationException::withMessages(['code' => ['That code didn\'t work. Sign in again if the prompt has expired.']]);
        }

        return response()->json([
            'user' => AuthController::selfPayload($user),
            'token' => AuthController::issueToken($user, $request),
        ]);
    }

    /**
     * Password, or a current code for an account that signs in through a
     * provider and has none. Same shape as closing an account
     * (AccountController) — proving intent, not identity twice over.
     */
    private function reauthenticate(Request $request)
    {
        $user = $request->user();

        abort_if(! $user->hasTwoFactor(), 422, 'Two-factor authentication is not on for this account.');

        if ($user->hasPassword()) {
            $data = $request->validate(['password' => ['required', 'string']]);

            if (! Hash::check($data['password'], $user->password)) {
                throw ValidationException::withMessages(['password' => ['That password is incorrect.']]);
            }

            return $user;
        }

        $data = $request->validate(['code' => ['required', 'string', 'max:32']]);

        if (! $this->twoFactor->verify($user, $data['code'])) {
            throw ValidationException::withMessages(['code' => ['That code is wrong or has expired.']]);
        }

        return $user;
    }
}
