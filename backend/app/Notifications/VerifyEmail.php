<?php

namespace App\Notifications;

use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;
use Illuminate\Support\Facades\URL;

/**
 * "Confirm your email address."
 *
 * The link points at the *backend*, not the app: it's a signed URL Laravel
 * can verify on its own, so clicking it is the whole interaction — no
 * token for the frontend to catch and POST back. The backend then bounces
 * to the app with a result in the fragment.
 */
class VerifyEmail extends Notification
{
    public function via(object $notifiable): array
    {
        return ['mail'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        return (new MailMessage)
            ->subject('Confirm your email address')
            ->greeting("Hi {$notifiable->name},")
            ->line('Confirm this address to finish setting up your open-card-studio account.')
            ->action('Confirm email address', $this->signedUrl($notifiable))
            ->line('The link is good for 60 minutes.')
            ->salutation('— open-card-studio');
    }

    public static function signedUrl(object $notifiable): string
    {
        return URL::temporarySignedRoute('verification.verify', now()->addMinutes(60), [
            'id' => $notifiable->getKey(),
            // The address is hashed into the URL so a link stops working
            // the moment the address changes — otherwise an old link would
            // verify a new, unconfirmed address.
            'hash' => sha1($notifiable->email),
        ]);
    }
}
