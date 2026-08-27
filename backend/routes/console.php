<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// Tokens expire (config/sanctum.php) but expiring doesn't delete the row.
// Without this the table grows forever and the sessions list fills with
// dead entries. --hours=24 keeps a day's grace so a just-expired session
// is still visible as "expired" rather than vanishing unexplained.
Schedule::command('sanctum:prune-expired --hours=24')->daily();
