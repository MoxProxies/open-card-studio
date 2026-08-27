<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Badge;

/**
 * The badge catalog — public, because "what can I earn" should be
 * answerable before you've earned anything. Granting a manual badge has
 * no endpoint yet on purpose: there's no staff role to authorise it, and
 * an ungated grant endpoint would be worse than none. Until the
 * moderation tooling in Phase 6 brings a real staff concept, a founder
 * awards one from tinker:
 *
 *   User::find(1)->badges()->syncWithoutDetaching(['pillar' => ['awarded_by' => 2]]);
 */
class BadgeController extends Controller
{
    public function index()
    {
        return response()->json(Badge::orderBy('id')->get()->map->toArray());
    }
}
