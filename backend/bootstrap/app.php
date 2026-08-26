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
        // There's no 'login' route to redirect an unauthenticated
        // request to (see the doc comment above) — Laravel's default
        // Authenticate::redirectTo() calls route('login') to build that
        // redirect target for any request that didn't send
        // `Accept: application/json`, and since that route doesn't
        // exist, resolving it throws RouteNotFoundException *during
        // middleware handling*, before the exception renderer below ever
        // runs — surfacing as an opaque 500 instead of a clean 401.
        // Always returning null here means "never redirect", so the
        // AuthenticationException instead propagates normally to be
        // rendered by shouldRenderJsonWhen below.
        $middleware->redirectGuestsTo(fn () => null);
    })
    ->withExceptions(function (Exceptions $exceptions) {
        // Every response this app ever sends is JSON — forcing this
        // unconditionally (rather than relying on every client
        // remembering an `Accept: application/json` header) is what a
        // pure API backend with no HTML views to fall back to should do
        // regardless of what a particular request's headers claim.
        $exceptions->shouldRenderJsonWhen(fn () => true);
    })->create();
