<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

/**
 * A suspension has to actually stop the account doing things, not just
 * hide its profile. Applied to every authenticated route except the three
 * a suspended user still needs — signing out, and reading or filing an
 * appeal (see AppealController) — so an existing token stops working
 * immediately rather than at its next expiry. The token isn't revoked, so
 * reinstating restores access without forcing a re-login.
 *
 * The refusal is a structured body, not just a sentence: `suspended: true`
 * is what tells a client to show the suspension screen (and with it the
 * way to contest the decision) rather than the generic "something went
 * wrong" any other 403 gets.
 */
class BlockSuspendedUsers
{
    public function handle(Request $request, Closure $next)
    {
        if (! $request->user()?->isSuspended()) {
            return $next($request);
        }

        return response()->json([
            'message' => 'This account is suspended. You can appeal the decision from your account.',
            'suspended' => true,
        ], 403);
    }
}
