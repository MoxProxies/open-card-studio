<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Password;

/**
 * Prints a password-reset link for an account.
 *
 * A support tool: when someone can't receive our email — a bounced
 * address, an over-eager spam filter, a corporate mail gateway — this is
 * how an operator hands them a working link without touching the
 * database. It's CLI-only, so using it already requires server access.
 *
 * The end-to-end tests use it too, for the same reason a human would:
 * the token exists only inside an email otherwise.
 */
class IssuePasswordResetLink extends Command
{
    protected $signature = 'auth:reset-link {email : The account to issue a link for}';

    protected $description = 'Print a password-reset link for an account (support tool)';

    public function handle(): int
    {
        $user = User::where('email', $this->argument('email'))->first();

        if (! $user) {
            $this->error('No account with that address.');

            return self::FAILURE;
        }

        if (! $user->hasPassword()) {
            $this->error('That account signs in through a provider and has no password to reset.');

            return self::FAILURE;
        }

        $frontend = rtrim((string) (config('frontend_urls')[0] ?? ''), '/');
        $token = Password::broker()->createToken($user);

        // Only the URL on stdout, so a script can use it directly.
        $this->line($frontend.'/#/reset-password?token='.urlencode($token).'&email='.urlencode($user->email));

        return self::SUCCESS;
    }
}
