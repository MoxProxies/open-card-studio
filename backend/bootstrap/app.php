<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;

/**
 * A pure token-auth API — there's no `web` route file/middleware group at
 * all, deliberately: the only clients are the React editor (calling in
 * with a Sanctum bearer token, not a first-party SPA cookie session) and,
 * eventually, the iOS/Android apps this backend is meant to serve
 * identically. See routes/api.php for the actual route list.
 */
return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware) {
        //
    })
    ->withExceptions(function (Exceptions $exceptions) {
        //
    })->create();
