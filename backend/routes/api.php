<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\CardDesignController;
use App\Http\Controllers\Api\PluginController;
use App\Http\Controllers\Api\TemplateController;
use Illuminate\Support\Facades\Route;

Route::post('/auth/register', [AuthController::class, 'register']);
Route::post('/auth/login', [AuthController::class, 'login']);

// The plugin registry is public — it's a discovery index, not user data;
// an app should be able to show "available plugins" before login.
Route::get('/plugins', [PluginController::class, 'index']);

// Browsing published community templates, and starting a design from one,
// deliberately need no account — same reasoning as the plugin registry
// above: this is a discovery surface, and a signed-out visitor's design
// still saves (to localStorage) until they sign in. Publishing one, and
// managing your own, is what requires auth — see the group below.
// TemplateController::show() reads a bearer token when one *is* sent so
// an owner can still fetch their own private draft through it.
Route::get('/templates/browse', [TemplateController::class, 'browse']);
Route::get('/templates/{id}', [TemplateController::class, 'show']);
// Throttled rather than authenticated: see TemplateController::use()'s
// doc comment for why a signed-out use still has to count.
Route::post('/templates/{id}/use', [TemplateController::class, 'use'])->middleware('throttle:30,1');

Route::middleware('auth:sanctum')->group(function () {
    Route::post('/auth/logout', [AuthController::class, 'logout']);
    Route::get('/auth/me', [AuthController::class, 'me']);

    // PUT, not POST+PATCH: the frontend always already has an id (a
    // client-generated UUID — see CardDesignController::upsert()'s doc
    // comment), so every save is the same upsert call regardless of
    // whether this is the design's first save or its fiftieth.
    Route::get('/card-designs', [CardDesignController::class, 'index']);
    Route::get('/card-designs/{id}', [CardDesignController::class, 'show']);
    Route::put('/card-designs/{id}', [CardDesignController::class, 'upsert']);
    Route::delete('/card-designs/{id}', [CardDesignController::class, 'destroy']);

    // PUT-upsert-by-id for the same reason card-designs uses it — the
    // editor already has the id before the first save. `/templates` here
    // is "my templates" (every visibility); the public gallery is
    // `/templates/browse` above.
    Route::get('/templates', [TemplateController::class, 'index']);
    Route::put('/templates/{id}', [TemplateController::class, 'upsert']);
    Route::post('/templates/{id}/publish', [TemplateController::class, 'publish']);
    Route::delete('/templates/{id}', [TemplateController::class, 'destroy']);
});
