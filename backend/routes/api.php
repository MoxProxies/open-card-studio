<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\CardDesignController;
use App\Http\Controllers\Api\CollectionController;
use App\Http\Controllers\Api\BadgeController;
use App\Http\Controllers\Api\FeatureController;
use App\Http\Controllers\Api\CommentController;
use App\Http\Controllers\Api\ModerationController;
use App\Http\Controllers\Api\PluginController;
use App\Http\Controllers\Api\PostController;
use App\Http\Controllers\Api\ReactionController;
use App\Http\Controllers\Api\ProfileController;
use App\Http\Controllers\Api\ReportController;
use App\Http\Controllers\Api\TemplateController;
use Illuminate\Support\Facades\Route;

Route::post('/auth/register', [AuthController::class, 'register']);
Route::post('/auth/login', [AuthController::class, 'login']);

// The plugin registry is public — it's a discovery index, not user data;
// an app should be able to show "available plugins" before login.
Route::get('/plugins', [PluginController::class, 'index']);

// The badge catalog is public: "what can I earn" should be answerable
// before you've earned anything.
Route::get('/badges', [BadgeController::class, 'index']);

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

// A public profile is the page a shared template is meant to lead back to,
// so it can't require an account either. `email` never appears in one —
// see User::$hidden.
Route::get('/users/{username}', [ProfileController::class, 'show']);
// A published collection is a public page, like a published template.
Route::get('/collections/{id}', [CollectionController::class, 'show']);

// The knowledge base. Public to read — a guide nobody can find without an
// account is a guide nobody reads. Posts are addressed by slug, not uuid:
// the slug is the URL people share.
Route::get('/posts', [PostController::class, 'browse']);
Route::get('/posts/{slug}', [PostController::class, 'show']);
Route::get('/posts/{slug}/comments', [CommentController::class, 'index']);

// BlockSuspendedUsers on the whole authenticated group: a suspension has
// to stop the account doing anything, not just hide its profile.
Route::middleware(['auth:sanctum', \App\Http\Middleware\BlockSuspendedUsers::class])->group(function () {
    Route::post('/auth/logout', [AuthController::class, 'logout']);
    Route::get('/auth/me', [AuthController::class, 'me']);

    // PUT, not POST+PATCH: the frontend always already has an id (a
    // client-generated UUID — see CardDesignController::upsert()'s doc
    // comment), so every save is the same upsert call regardless of
    // whether this is the design's first save or its fiftieth.
    Route::patch('/profile', [ProfileController::class, 'update']);

    // One reaction endpoint for every content type — see the reactions
    // migration. POST toggles and returns the resulting state.
    Route::post('/reactions', [ReactionController::class, 'toggle'])->middleware('throttle:120,1');
    // Featuring your own work on your profile; level-gated in config.
    Route::post('/featured', [FeatureController::class, 'update']);

    // One report endpoint for every content type — see ReportController.
    // Auth'd: an anonymous report queue is a spam queue.
    Route::post('/reports', [ReportController::class, 'store'])->middleware('throttle:20,1');

    Route::get('/card-designs', [CardDesignController::class, 'index']);
    Route::get('/card-designs/{id}', [CardDesignController::class, 'show']);
    Route::put('/card-designs/{id}', [CardDesignController::class, 'upsert']);
    Route::post('/card-designs/{id}/publish', [CardDesignController::class, 'publish']);
    Route::delete('/card-designs/{id}', [CardDesignController::class, 'destroy']);

    // PUT-upsert-by-id for the same reason card-designs uses it — the
    // editor already has the id before the first save. `/templates` here
    // is "my templates" (every visibility); the public gallery is
    // `/templates/browse` above.
    Route::get('/collections', [CollectionController::class, 'index']);
    Route::put('/collections/{id}', [CollectionController::class, 'upsert']);
    Route::post('/collections/{id}/publish', [CollectionController::class, 'publish']);
    Route::delete('/collections/{id}', [CollectionController::class, 'destroy']);
    // Membership: both sides owner-scoped — see CollectionController::addDesign.
    Route::put('/collections/{id}/designs/{designId}', [CollectionController::class, 'addDesign']);
    Route::delete('/collections/{id}/designs/{designId}', [CollectionController::class, 'removeDesign']);

    Route::get('/my/posts', [PostController::class, 'index']);
    Route::put('/posts/{id}', [PostController::class, 'upsert']);
    Route::post('/posts/{id}/publish', [PostController::class, 'publish']);
    Route::delete('/posts/{id}', [PostController::class, 'destroy']);
    // Edit history — owner-only until there's a staff role, see the controller.
    Route::get('/posts/{id}/revisions', [PostController::class, 'revisions']);
    Route::post('/posts/{slug}/comments', [CommentController::class, 'store'])->middleware('throttle:30,1');
    Route::delete('/comments/{id}', [CommentController::class, 'destroy']);

    // Staff only, and EnsureStaff 404s for everyone else so the surface
    // isn't discoverable — see that middleware.
    Route::middleware(\App\Http\Middleware\EnsureStaff::class)->prefix('moderation')->group(function () {
        Route::get('/reports', [ModerationController::class, 'reports']);
        Route::post('/reports/{id}', [ModerationController::class, 'resolveReport']);
        Route::post('/takedown', [ModerationController::class, 'takedown']);
        Route::post('/users/{id}/suspend', [ModerationController::class, 'suspend']);
        Route::post('/users/{id}/badges', [ModerationController::class, 'badge']);
        Route::get('/actions', [ModerationController::class, 'actions']);
    });

    Route::get('/templates', [TemplateController::class, 'index']);
    Route::put('/templates/{id}', [TemplateController::class, 'upsert']);
    Route::post('/templates/{id}/publish', [TemplateController::class, 'publish']);
    Route::delete('/templates/{id}', [TemplateController::class, 'destroy']);
});
