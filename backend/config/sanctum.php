<?php

return [
    // Left empty on purpose: this API has no first-party SPA cookie
    // client and never will (see bootstrap/app.php) — every client
    // (the React editor, iOS, Android) authenticates the same way, with
    // a bearer token from POST /api/auth/login, checked via the
    // auth:sanctum guard. 'stateful' domains only matter for Sanctum's
    // cookie-based SPA mode, which this app doesn't use.
    'stateful' => [],

    'guard' => ['web'],

    'expiration' => null,

    'token_prefix' => env('SANCTUM_TOKEN_PREFIX', ''),

    'middleware' => [
        'authenticate_session' => Laravel\Sanctum\Http\Middleware\AuthenticateSession::class,
        'encrypt_cookies' => Illuminate\Cookie\Middleware\EncryptCookies::class,
        'validate_csrf_token' => Illuminate\Foundation\Http\Middleware\ValidateCsrfToken::class,
    ],
];
