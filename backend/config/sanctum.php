<?php

use Illuminate\Cookie\Middleware\EncryptCookies;
use Illuminate\Foundation\Http\Middleware\ValidateCsrfToken;
use Laravel\Sanctum\Http\Middleware\AuthenticateSession;

return [
    // Left empty on purpose: this API has no first-party SPA cookie
    // client and never will (see bootstrap/app.php) — every client
    // (the React editor, iOS, Android) authenticates the same way, with
    // a bearer token from POST /api/auth/login, checked via the
    // auth:sanctum guard. 'stateful' domains only matter for Sanctum's
    // cookie-based SPA mode, which this app doesn't use.
    'stateful' => [],

    'guard' => ['web'],

    // Tokens expire. A bearer token that never does is a permanent
    // credential sitting in a browser's localStorage — one stolen laptop
    // and there is no clock running against the attacker. 30 days by
    // default, tunable per deployment; Sanctum enforces this against
    // `created_at` *and* honours each token's own `expires_at`, whichever
    // is stricter, so raising it later can't retroactively resurrect
    // tokens that were already issued with a shorter one.
    'expiration' => (int) env('SANCTUM_TOKEN_TTL_MINUTES', 60 * 24 * 30),

    'token_prefix' => env('SANCTUM_TOKEN_PREFIX', ''),

    'middleware' => [
        'authenticate_session' => AuthenticateSession::class,
        'encrypt_cookies' => EncryptCookies::class,
        'validate_csrf_token' => ValidateCsrfToken::class,
    ],
];
