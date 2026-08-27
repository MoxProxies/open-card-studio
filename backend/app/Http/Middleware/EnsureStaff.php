<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

/**
 * Gate for the moderation endpoints. 404 rather than 403 on purpose: an
 * endpoint that answers "403, you're not staff" tells a prober that a
 * moderation surface exists and is worth attacking. Staff know where it
 * is; nobody else needs to learn.
 */
class EnsureStaff
{
    public function handle(Request $request, Closure $next)
    {
        abort_unless($request->user()?->is_staff, 404);

        return $next($request);
    }
}
