<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        //
    }

    public function boot(): void
    {
        $this->configureRateLimiters();
        //
    }

    /**
     * Named limits for the endpoints worth attacking.
     *
     * Login is keyed by **email and IP together**, not by IP alone. IP
     * alone is worse in both directions: it lets one attacker behind a
     * NAT lock out everyone else sharing that address, and it does
     * nothing about a distributed attempt on one account. Keying on the
     * pair limits the thing actually being guessed.
     *
     * Registration stays per-IP but loose — tight enough to stop mass
     * signup, loose enough that an office, a mobile carrier's NAT, or a
     * test suite creating accounts isn't locked out.
     */
    private function configureRateLimiters(): void
    {
        RateLimiter::for('login', fn (Request $request) => [
            Limit::perMinute(5)->by(mb_strtolower((string) $request->input('email')).'|'.$request->ip()),
        ]);

        RateLimiter::for('register', fn (Request $request) => Limit::perMinute(30)->by($request->ip()));

        RateLimiter::for('social', fn (Request $request) => Limit::perMinute(20)->by($request->ip()));
    }
}
