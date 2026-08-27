<?php

namespace App\Support;

use App\Models\User;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;
use PragmaRX\Google2FA\Exceptions\Google2FAException;
use PragmaRX\Google2FA\Google2FA;

/**
 * TOTP second factor: secrets, codes, recovery codes, and the short-lived
 * challenge that sits between a correct password and an API token.
 *
 * The actual RFC 6238 arithmetic is pragmarx/google2fa's — hand-rolling
 * it is thirty lines and a decade of edge cases nobody wants to own.
 * What's here is everything around it that a library can't decide for
 * you: how long a code stays valid, what stops one being replayed, how
 * many wrong guesses a challenge survives, and what a recovery code is.
 */
class TwoFactor
{
    /**
     * One step either side of now (±30s). Zero drift tolerance rejects
     * codes from phones whose clock is a few seconds out, which is most
     * phones; a wider window is a longer replay opportunity for a code
     * read over someone's shoulder.
     */
    private const WINDOW = 1;

    /** How long a challenge survives between password and code. Long
     * enough to fetch a phone, short enough not to be worth stealing. */
    private const CHALLENGE_MINUTES = 5;

    /** Wrong codes a single challenge tolerates before it's void and the
     * password has to be entered again. Six digits is a million
     * combinations; this is what keeps it that way. */
    private const MAX_CHALLENGE_ATTEMPTS = 5;

    private const RECOVERY_CODE_COUNT = 8;

    public function __construct(private Google2FA $google2fa) {}

    public function secret(): string
    {
        return $this->google2fa->generateSecretKey();
    }

    /**
     * The otpauth:// URI an authenticator app scans. The issuer and label
     * are what the user sees in their app's list, so the label is the
     * email address — "open-card-studio" alone is useless to anyone with
     * two accounts.
     */
    public function provisioningUri(User $user, string $secret): string
    {
        return $this->google2fa->getQRCodeUrl(config('app.name'), $user->email, $secret);
    }

    /** Eight single-use codes, shown once. Formatted in two groups
     * because they get written down, and a 10-character run of base32
     * gets transcribed wrong. */
    public function recoveryCodes(): array
    {
        return collect(range(1, self::RECOVERY_CODE_COUNT))
            ->map(fn () => Str::lower(Str::random(5).'-'.Str::random(5)))
            ->all();
    }

    /**
     * Check a code from the authenticator app, then refuse it forever.
     *
     * The replay guard is the part a library won't do for you: a code is
     * valid for a whole timestep, so without this, one observed code
     * works again for up to 90 seconds (the step, plus the drift window
     * either side). Remembering the accepted timestep per user closes
     * that.
     */
    public function verifyCode(User $user, string $code): bool
    {
        if (! $user->two_factor_secret) {
            return false;
        }

        try {
            $timestamp = $this->google2fa->verifyKeyNewer(
                $user->two_factor_secret,
                $code,
                Cache::get($this->replayKey($user)) ?: null,
                self::WINDOW,
            );
        } catch (Google2FAException $e) {
            // The library throws on a malformed secret or an
            // implausibly-sized key. That's a wrong code, not a server
            // error — a mistyped digit must never surface as a 500.
            return false;
        }

        if ($timestamp === false || $timestamp === null) {
            return false;
        }

        // Kept a little longer than the window it protects, so the entry
        // can't expire while a code it would have rejected is still valid.
        Cache::put($this->replayKey($user), $timestamp, now()->addMinutes(5));

        return true;
    }

    /** Spends one recovery code. Single use: it's removed whether or not
     * anything later in the request succeeds. */
    public function consumeRecoveryCode(User $user, string $code): bool
    {
        $codes = $user->two_factor_recovery_codes ?? [];
        $normalized = Str::lower(trim($code));

        if (! in_array($normalized, $codes, true)) {
            return false;
        }

        $user->two_factor_recovery_codes = array_values(array_diff($codes, [$normalized]));
        $user->save();

        return true;
    }

    /** Either kind of code — the app's, or a recovery code. Callers don't
     * care which, and telling them apart in the error message would say
     * which one was closer to right. */
    public function verify(User $user, string $code): bool
    {
        return $this->verifyCode($user, $code) || $this->consumeRecoveryCode($user, $code);
    }

    /**
     * Hands out the ticket that stands in for "this password was
     * correct" while the code is being typed.
     *
     * Server-side and opaque, for the same reason the OAuth state nonce
     * is (SocialAuthController): anything the client holds between the
     * two halves of a sign-in has to be unguessable and has to expire on
     * its own.
     */
    public function startChallenge(User $user): string
    {
        $id = Str::random(64);
        Cache::put($this->challengeKey($id), ['user_id' => $user->id, 'attempts' => 0], now()->addMinutes(self::CHALLENGE_MINUTES));

        return $id;
    }

    /**
     * Redeems a challenge, or explains why it can't be.
     *
     * A wrong code doesn't void the challenge — a typo forcing the whole
     * password round again is how people end up turning 2FA off — but
     * MAX_CHALLENGE_ATTEMPTS of them does.
     */
    public function completeChallenge(string $id, string $code): ?User
    {
        $state = Cache::get($this->challengeKey($id));

        if (! $state || ! ($user = User::find($state['user_id']))) {
            return null;
        }

        if ($this->verify($user, $code)) {
            Cache::forget($this->challengeKey($id));

            return $user;
        }

        $state['attempts']++;

        if ($state['attempts'] >= self::MAX_CHALLENGE_ATTEMPTS) {
            Cache::forget($this->challengeKey($id));
        } else {
            Cache::put($this->challengeKey($id), $state, now()->addMinutes(self::CHALLENGE_MINUTES));
        }

        return null;
    }

    private function challengeKey(string $id): string
    {
        return 'two-factor:challenge:'.$id;
    }

    private function replayKey(User $user): string
    {
        return 'two-factor:last-step:'.$user->id;
    }
}
