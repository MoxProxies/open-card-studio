<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\CardDesignController;
use App\Http\Controllers\Api\PluginController;
use Illuminate\Support\Facades\Route;

Route::post('/auth/register', [AuthController::class, 'register']);
Route::post('/auth/login', [AuthController::class, 'login']);

// The plugin registry is public — it's a discovery index, not user data;
// an app should be able to show "available plugins" before login.
Route::get('/plugins', [PluginController::class, 'index']);

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
});
