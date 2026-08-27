<?php

namespace App\Support;

/**
 * Which OAuth providers this deployment offers, and whether each one can
 * be trusted about email addresses.
 *
 * A provider is enabled by being configured — no client id, no button and
 * no working route. That way a half-configured provider never shows up as
 * a sign-in option that dead-ends.
 */
class SocialProviders
{
    public const SUPPORTED = ['google', 'github'];

    /** Configured, and therefore offered. */
    public static function enabled(): array
    {
        return array_values(array_filter(
            self::SUPPORTED,
            fn (string $provider) => (bool) config("services.{$provider}.client_id"),
        ));
    }

    public static function isEnabled(string $provider): bool
    {
        return in_array($provider, self::enabled(), true);
    }

    /** For the sign-in UI. */
    public static function forClient(): array
    {
        $labels = ['google' => 'Google', 'github' => 'GitHub'];

        return array_map(fn (string $p) => ['id' => $p, 'label' => $labels[$p] ?? ucfirst($p)], self::enabled());
    }

    /**
     * Whether a provider's reported email can be trusted enough to link a
     * social sign-in to a pre-existing account with that address.
     *
     * This is the account-takeover question, and it's why linking isn't
     * just "match on email": if a provider lets someone claim an address
     * they don't own, then signing in with that provider would hand them
     * somebody else's account. Google reports verification explicitly, and
     * GitHub's API only returns a primary email that it has verified —
     * see SocialAuthController::emailIsVerified for how each is read.
     */
    public static function canVerifyEmail(string $provider): bool
    {
        return in_array($provider, ['google', 'github'], true);
    }
}
