<?php

namespace App\Notifications;

use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;
use Illuminate\Support\Facades\URL;

/**
 * "Here's what happened while you were away."
 *
 * One email covering everything unread since the last one, rather than a
 * message per event: the alternative is that a template getting ten likes
 * sends ten emails, which is how a useful digest becomes a filter rule.
 *
 * The unsubscribe link is a signed URL to the backend, so it works from
 * the email in one click with no sign-in — the standard every mail
 * provider expects, and the thing that makes defaulting this on
 * defensible.
 */
class NotificationDigest extends Notification
{
    /** @param array<int, string> $lines */
    public function __construct(private array $lines) {}

    public function via(object $notifiable): array
    {
        return ['mail'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        $count = count($this->lines);

        $message = (new MailMessage)
            ->subject($count === 1 ? 'Something happened on open-card-studio' : "{$count} things happened on open-card-studio")
            ->greeting("Hi {$notifiable->name},");

        foreach ($this->lines as $line) {
            $message->line($line);
        }

        return $message
            ->action('Open card studio', rtrim((string) (config('frontend_urls')[0] ?? ''), '/'))
            ->line('Not interested in these? [Turn them off]('.self::unsubscribeUrl($notifiable).') — one click, no sign-in needed.')
            ->salutation('— open-card-studio');
    }

    /** Deliberately long-lived: an unsubscribe link that has expired by
     * the time someone is annoyed enough to click it is worse than
     * useless. The hash means it stops working if the address changes. */
    public static function unsubscribeUrl(object $notifiable): string
    {
        return URL::signedRoute('notifications.unsubscribe', [
            'id' => $notifiable->getKey(),
            'hash' => sha1($notifiable->email),
        ]);
    }
}
