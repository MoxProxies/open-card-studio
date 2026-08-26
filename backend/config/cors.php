<?php

return [
    'paths' => ['api/*', 'up'],

    'allowed_methods' => ['*'],

    // The React editor runs on its own origin (Vite dev server, or its
    // own production domain) — a bearer-token API, unlike a
    // cookie-session one, doesn't need allowed_origins restricted for
    // CSRF-safety reasons, but keep this to actual known frontends
    // rather than '*' regardless, since a wildcard also disables
    // allowed_origins_patterns matching against credentialed requests.
    'allowed_origins' => array_filter(explode(',', env('CORS_ALLOWED_ORIGINS', 'http://localhost:5173'))),

    'allowed_origins_patterns' => [],

    'allowed_headers' => ['*'],

    'exposed_headers' => [],

    'max_age' => 0,

    'supports_credentials' => false,
];
