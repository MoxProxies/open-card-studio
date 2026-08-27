<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Mailer
    |--------------------------------------------------------------------------
    |
    | Transactional mail goes through Brevo's SMTP relay. SMTP rather than
    | Brevo's HTTP API on purpose: it needs no extra package, and it means
    | swapping providers later is an .env change rather than a code change.
    |
    | The default is `log`, not `smtp`. A developer who hasn't configured
    | Brevo should get the email written to storage/logs, not a connection
    | error on every signup — and nothing should be able to send real mail
    | to real addresses by accident from a laptop.
    |
    */

    'default' => env('MAIL_MAILER', 'log'),

    'mailers' => [

        'smtp' => [
            'transport' => 'smtp',
            // Brevo's relay. The username is the account's SMTP login and
            // the password is an SMTP key generated in Brevo — not the
            // account password.
            'host' => env('MAIL_HOST', 'smtp-relay.brevo.com'),
            'port' => (int) env('MAIL_PORT', 587),
            'encryption' => env('MAIL_ENCRYPTION', 'tls'),
            'username' => env('MAIL_USERNAME'),
            'password' => env('MAIL_PASSWORD'),
            'timeout' => 15,
        ],

        'log' => [
            'transport' => 'log',
            'channel' => env('MAIL_LOG_CHANNEL'),
        ],

        // What the tests use — see phpunit.xml.
        'array' => [
            'transport' => 'array',
        ],

    ],

    /*
    | The From address has to be a sender Brevo has verified for the
    | account, or it will refuse the message.
    */
    'from' => [
        'address' => env('MAIL_FROM_ADDRESS', 'hello@example.com'),
        'name' => env('MAIL_FROM_NAME', 'open-card-studio'),
    ],

];
