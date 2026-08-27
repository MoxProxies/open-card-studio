<?php

use App\Http\Controllers\Api\AccountController;
use App\Http\Controllers\Api\AppealController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\BadgeController;
use App\Http\Controllers\Api\CardDesignController;
use App\Http\Controllers\Api\CollectionController;
use App\Http\Controllers\Api\CommentController;
use App\Http\Controllers\Api\EmailController;
use App\Http\Controllers\Api\FeatureController;
use App\Http\Controllers\Api\ModerationController;
use App\Http\Controllers\Api\PluginController;
use App\Http\Controllers\Api\PostController;
use App\Http\Controllers\Api\ProfileController;
use App\Http\Controllers\Api\ReactionController;
use App\Http\Controllers\Api\ReportController;
use App\Http\Controllers\Api\SocialAuthController;
use App\Http\Controllers\Api\TemplateController;
use App\Http\Middleware\BlockSuspendedUsers;
use App\Http\Middleware\EnsureStaff;
use Illuminate\Support\Facades\Route;

// Throttled: these are the endpoints worth brute-forcing, and the cost of
// a wrong guess should not be zero. The limits are defined in
// AppServiceProvider — login is keyed by email *and* IP so one attacker
// can't lock out everyone behind the same NAT.
Route::post('/auth/register', [AuthController::class, 'register'])->middleware('throttle:register');
// login has no throttle middleware on purpose — AuthController::login
// rate-limits failures only, so signing in successfully on a third device
// isn't treated like guessing.
Route::post('/auth/login', [AuthController::class, 'login']);

// Social sign-in. `providers` is public because the sign-in screen asks
// which buttons to draw before anyone has signed in; `start` and
// `callback` 404 for a provider this deployment hasn't configured.
Route::get('/auth/providers', [SocialAuthController::class, 'providers']);

// Password reset. Throttled hard: this endpoint sends mail to an address
// the caller names, so an unthrottled one is a spam cannon pointed at
// whoever they like. It always answers the same way — see
// EmailController on not leaking whether an address is registered.
Route::post('/auth/password/forgot', [EmailController::class, 'forgotPassword'])->middleware('throttle:password-forgot');
Route::post('/auth/password/reset', [EmailController::class, 'resetPassword'])->middleware('throttle:password-reset');

// The confirmation link's target. Signed by Laravel rather than carrying
// a token of ours, so clicking it is the whole interaction.
Route::get('/auth/email/verify/{id}/{hash}', [EmailController::class, 'verify'])
    ->middleware('signed')
    ->name('verification.verify');
Route::middleware('throttle:social')->group(function () {
    Route::post('/auth/{provider}/start', [SocialAuthController::class, 'start']);
    Route::get('/auth/{provider}/callback', [SocialAuthController::class, 'callback']);
});

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

// Authenticated, but *not* behind BlockSuspendedUsers — the three things
// a suspended account still has to be able to do. Signing out must always
// work, and an appeal route a suspended user can't reach could only ever
// be used by people with nothing to appeal.
Route::middleware('auth:sanctum')->group(function () {
    Route::post('/auth/logout', [AuthController::class, 'logout']);
    Route::get('/auth/appeal', [AppealController::class, 'show']);
    Route::post('/auth/appeal', [AppealController::class, 'store'])->middleware('throttle:5,60');
});

// BlockSuspendedUsers on everything else: a suspension has to stop the
// account doing anything, not just hide its profile.
Route::middleware(['auth:sanctum', BlockSuspendedUsers::class])->group(function () {
    Route::post('/auth/logout-everywhere', [AuthController::class, 'logoutEverywhere']);

    // Data rights (see AccountController). The export walks every table
    // this account touches, so it's throttled; deleting re-authenticates
    // in the controller rather than relying on the session alone.
    Route::get('/account/export', [AccountController::class, 'export'])->middleware('throttle:5,60');
    Route::delete('/account', [AccountController::class, 'destroy']);
    // The account's own live tokens, and revoking one of them. Scoped to
    // $request->user()'s tokens in the controller, so an id from another
    // account 404s rather than revoking someone else's session.
    Route::get('/auth/sessions', [AuthController::class, 'sessions']);
    Route::delete('/auth/sessions/{id}', [AuthController::class, 'revokeSession']);
    Route::post('/auth/email/verify/send', [EmailController::class, 'sendVerification'])->middleware('throttle:5,1');
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
    Route::middleware(EnsureStaff::class)->prefix('moderation')->group(function () {
        Route::get('/reports', [ModerationController::class, 'reports']);
        Route::post('/reports/{id}', [ModerationController::class, 'resolveReport']);
        Route::post('/takedown', [ModerationController::class, 'takedown']);
        Route::post('/users/{id}/suspend', [ModerationController::class, 'suspend']);
        // The other side of AppealController: reading what suspended
        // accounts wrote back, and deciding. Granting reinstates.
        Route::get('/appeals', [ModerationController::class, 'appeals']);
        Route::post('/appeals/{id}', [ModerationController::class, 'resolveAppeal']);
        Route::post('/users/{id}/badges', [ModerationController::class, 'badge']);
        Route::get('/actions', [ModerationController::class, 'actions']);
    });

    Route::get('/templates', [TemplateController::class, 'index']);
    Route::put('/templates/{id}', [TemplateController::class, 'upsert']);
    Route::post('/templates/{id}/publish', [TemplateController::class, 'publish']);
    Route::delete('/templates/{id}', [TemplateController::class, 'destroy']);
});
