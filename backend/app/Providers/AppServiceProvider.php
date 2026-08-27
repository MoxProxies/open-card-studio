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
     * Named limits for the endpoints worth attacking. Login isn't here:
     * it limits *failed* attempts only, which middleware can't express,
     * so it does its own counting — see AuthController::login.
     *
     * Registration is per-IP but loose — tight enough to stop mass
     * signup, loose enough that an office, a mobile carrier's NAT, or a
     * test suite creating accounts isn't locked out.
     */
    private function configureRateLimiters(): void
    {
        RateLimiter::for('register', fn (Request $request) => Limit::perMinute(config('security.register_per_minute'))->by($request->ip()));

        RateLimiter::for('social', fn (Request $request) => Limit::perMinute(20)->by($request->ip()));

        // Asking for a reset sends mail to an address the caller names, so
        // it's tight — but keyed by email+IP, or one person requesting a
        // couple of resets would block everyone behind the same address.
        RateLimiter::for('password-forgot', fn (Request $request) => Limit::perMinute(3)
            ->by(mb_strtolower((string) $request->input('email')).'|'.$request->ip()));

        // *Completing* a reset needs a valid single-use token, so it isn't
        // the same abuse surface — and sharing one bucket with the request
        // above meant asking for a reset could use up your ability to
        // finish one.
        RateLimiter::for('password-reset', fn (Request $request) => Limit::perMinute(10)->by($request->ip()));
    }
}
