<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third-party services
    |--------------------------------------------------------------------------
    |
    | Socialite reads services.{provider} for its OAuth credentials.
    |
    | A provider is **enabled by being configured**: with no client id
    | there's no button in the app and no route that works (see
    | SocialAuthController::assertEnabled). That stops a half-configured
    | provider showing up as a sign-in option that dead-ends.
    |
    | Redirect URI to register with each provider:
    |   {APP_URL}/api/auth/{provider}/callback
    |
    */

    'google' => [
        'client_id' => env('GOOGLE_CLIENT_ID'),
        'client_secret' => env('GOOGLE_CLIENT_SECRET'),
        'redirect' => env('APP_URL', 'http://localhost:8000').'/api/auth/google/callback',
    ],

    'github' => [
        'client_id' => env('GITHUB_CLIENT_ID'),
        'client_secret' => env('GITHUB_CLIENT_SECRET'),
        'redirect' => env('APP_URL', 'http://localhost:8000').'/api/auth/github/callback',
    ],

];
