<?php

namespace App\Support;

use App\Models\Notification;

/**
 * One sentence per notification, for the email digest.
 *
 * The app has its own copy of this in TypeScript (api/notifications.ts):
 * the two are deliberately separate rather than the client rendering
 * server-built strings, because the app can re-render its wording (and
 * later, translate it) without a migration, while an email has to be
 * written at the moment it's sent. Keep them saying the same thing.
 */
class NotificationText
{
    public static function describe(Notification $notification): string
    {
        $who = $notification->actor?->name ?? ($notification->data['actor_name'] ?? 'Someone');
        $what = isset($notification->data['title']) ? "“{$notification->data['title']}”" : 'your work';

        return match ($notification->type) {
            'reaction' => "{$who} liked {$what}.",
            'comment' => "{$who} commented on {$what}.",
            'remix' => "{$who} remixed {$what}.",
            'badge' => 'You earned the '.($notification->data['badge'] ?? 'a').' badge.',
            'moderation' => "{$what} was removed by moderation".(isset($notification->data['reason']) ? ": {$notification->data['reason']}" : '.'),
            'appeal' => ($notification->data['state'] ?? '') === 'granted'
                ? 'Your appeal was granted.'
                : 'Your appeal was declined.',
            default => 'Something happened.',
        };
    }
}
