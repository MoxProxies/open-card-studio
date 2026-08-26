<?php

return [
    'defaults' => [
        'guard' => 'web',
        'passwords' => 'users',
    ],

    // Sanctum's TransientToken (see routes/api.php's auth:sanctum-guarded
    // routes) resolves against this 'web' guard's provider when a bearer
    // token is presented — there's no session-based web guard actually in
    // use anywhere (see bootstrap/app.php's doc comment), this just has
    // to exist because Sanctum's internals expect a default guard name.
    'guards' => [
        'web' => [
            'driver' => 'session',
            'provider' => 'users',
        ],
    ],

    'providers' => [
        'users' => [
            'driver' => 'eloquent',
            'model' => App\Models\User::class,
        ],
    ],

    'passwords' => [
        'users' => [
            'provider' => 'users',
            'table' => 'password_reset_tokens',
            'expire' => 60,
            'throttle' => 60,
        ],
    ],

    'password_timeout' => 10800,
];
