<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;

/**
 * Serves the known-plugin registry (config/plugins.php) so a client can
 * discover installable community plugins beyond whatever it bundled at
 * build time — a "plugin store" listing, not a code host. See that
 * config file's doc comment for why this starts as a flat config array
 * rather than a database table.
 */
class PluginController extends Controller
{
    public function index()
    {
        return response()->json(config('plugins.registry'));
    }
}
