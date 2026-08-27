<?php

namespace App\Notifications;

use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/**
 * "Reset your password."
 *
 * Unlike verification, this link goes to the **app**, not the API: the
 * user has to type a new password, so the token has to land somewhere
 * that can show a form. The app reads it from the URL and posts it back
 * to /api/auth/password/reset.
 */
class ResetPassword extends Notification
{
    public function __construct(private readonly string $token) {}

    public function via(object $notifiable): array
    {
        return ['mail'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        $frontend = rtrim((string) (config('frontend_urls')[0] ?? ''), '/');
        $url = $frontend.'/#/reset-password?token='.urlencode($this->token).'&email='.urlencode($notifiable->email);

        return (new MailMessage)
            ->subject('Reset your password')
            ->greeting("Hi {$notifiable->name},")
            ->line('Someone asked to reset the password on your open-card-studio account.')
            ->action('Choose a new password', $url)
            ->line('The link is good for 60 minutes.')
            // Said plainly, because the common case for an unexpected
            // reset email is someone mistyping their own address — not an
            // attack — and the reassurance is what stops a support ticket.
            ->line("If this wasn't you, you can ignore this email. Your password won't change until someone opens that link and sets a new one.")
            ->salutation('— open-card-studio');
    }
}
