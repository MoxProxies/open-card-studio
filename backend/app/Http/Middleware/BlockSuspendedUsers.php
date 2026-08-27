<?php

namespace App\Http\Middleware;

use App\Models\User;
use Closure;
use Illuminate\Http\Request;

/**
 * A suspension has to actually stop the account doing things, not just
 * hide its profile. Applied to every authenticated route, so a suspended
 * user's existing token stops working immediately rather than at its next
 * expiry — the token isn't revoked, so reinstating restores access
 * without forcing a re-login.
 */
class BlockSuspendedUsers
{
    public function handle(Request $request, Closure $next)
    {
        abort_if(
            $request->user()?->moderation_state === User::SUSPENDED,
            403,
            'This account is suspended. Contact support if you think that is a mistake.',
        );

        return $next($request);
    }
}
