<?php

namespace App\Support;

use Illuminate\Http\Request;

/**
 * A human label for the device a token was issued to, so the sessions
 * list reads "Chrome on macOS" rather than "api" four times over.
 *
 * Deliberately crude, and deliberately not a user-agent parsing library:
 * this is a memory aid for "is one of these not me", not analytics. A
 * wrong guess costs nothing; a dependency that has to track every new
 * browser string costs maintenance forever. Anything unrecognised is
 * "Unknown device", which is honest.
 */
class DeviceName
{
    private const BROWSERS = [
        // Order matters — every Chromium browser also says "Chrome", and
        // Chrome/Safari both claim "Safari", so the specific names have
        // to be tested before the generic ones.
        'Edg/' => 'Edge',
        'OPR/' => 'Opera',
        'Firefox/' => 'Firefox',
        'Chrome/' => 'Chrome',
        'Safari/' => 'Safari',
    ];

    private const PLATFORMS = [
        // iPhone before Mac: iOS Safari's UA contains "like Mac OS X".
        'iPhone' => 'iPhone',
        'iPad' => 'iPad',
        'Android' => 'Android',
        'Windows' => 'Windows',
        'Mac OS X' => 'macOS',
        'Linux' => 'Linux',
    ];

    public static function from(Request $request): string
    {
        $agent = (string) $request->userAgent();

        $browser = self::firstMatch($agent, self::BROWSERS);
        $platform = self::firstMatch($agent, self::PLATFORMS);

        return match (true) {
            $browser && $platform => "{$browser} on {$platform}",
            (bool) $browser => $browser,
            (bool) $platform => $platform,
            default => 'Unknown device',
        };
    }

    private static function firstMatch(string $agent, array $needles): ?string
    {
        foreach ($needles as $needle => $label) {
            if (str_contains($agent, $needle)) {
                return $label;
            }
        }

        return null;
    }
}
