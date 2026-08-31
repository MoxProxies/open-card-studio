<?php

namespace App\Console\Commands;

use App\Models\Notification;
use App\Models\User;
use App\Notifications\NotificationDigest;
use App\Support\NotificationText;
use Illuminate\Console\Command;

/**
 * Emails everyone the things they haven't seen.
 *
 * Scheduled daily (routes/console.php). Four rules decide who gets one,
 * and each exists because the alternative is a way to lose someone's
 * trust in the mail rather than just their attention:
 *
 *  - **Only unread.** Someone who already saw it in the app doesn't need
 *    it again in their inbox.
 *  - **Only newer than the last digest.** The watermark is what stops a
 *    second run repeating the first; a digest that repeats itself gets
 *    filed as spam by the reader, correctly.
 *  - **Only confirmed addresses.** Mailing an address nobody proved is
 *    how a sending domain earns a bounce rate and stops being delivered
 *    at all. This is also the first thing a verified address actually
 *    buys, which was an open question when verification shipped.
 *  - **Only people who want them.** One click from the email itself.
 */
class SendNotificationDigests extends Command
{
    protected $signature = 'notifications:digest {--user= : One account, by email — for checking what a digest looks like}';

    protected $description = 'Email each account a summary of the notifications it has not read';

    public function handle(): int
    {
        $query = User::query()
            ->where('notification_emails', true)
            ->whereNotNull('email_verified_at');

        if ($email = $this->option('user')) {
            $query->where('email', $email);
        }

        $sent = 0;

        // chunkById rather than get(): this is the one job in the app that
        // touches every account, and holding them all in memory is a
        // problem that only appears once it's too late to notice.
        $query->chunkById(200, function ($users) use (&$sent) {
            foreach ($users as $user) {
                // Oldest-first, not latest(): the watermark below only
                // advances up to the newest item actually sent, so
                // anything past the cap has to be *newer* than that
                // boundary for it to survive to the next run. Capping a
                // newest-first list instead would drop the oldest items
                // beyond the 20, which are older than everything sent —
                // already behind any watermark that batch could produce.
                $pending = Notification::query()
                    ->where('user_id', $user->id)
                    ->unread()
                    ->when($user->notifications_emailed_at, fn ($q) => $q->where('created_at', '>', $user->notifications_emailed_at))
                    ->with('actor:id,name,username')
                    ->oldest()
                    ->limit(20)
                    ->get();

                if ($pending->isEmpty()) {
                    continue;
                }

                $user->notify(new NotificationDigest($pending->map(NotificationText::describe(...))->all()));

                // Moved *after* a successful queue/send: leaving it until
                // afterwards means a failure re-sends tomorrow rather
                // than silently swallowing the whole batch.
                //
                // The watermark is the newest notification actually *in*
                // this batch — not `now()`. Someone with more than 20
                // unread since their last digest has leftovers newer than
                // that boundary; advancing to `now()` would put them
                // behind the watermark forever, unread in the app but
                // permanently excluded from every future digest.
                $user->notifications_emailed_at = $pending->last()->created_at;
                $user->save();
                $sent++;
            }
        });

        $this->info("Sent {$sent} digest".($sent === 1 ? '' : 's').'.');

        return self::SUCCESS;
    }
}
