<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            // On by default. A digest of things that happened to *your own*
            // work is the reason most people come back, and an opt-in
            // nobody sees is the same as the feature not existing — but
            // it's one click to stop, from the email itself, without
            // signing in (see NotificationController::unsubscribe).
            $table->boolean('notification_emails')->default(true);
            // The watermark. Only notifications newer than this are ever
            // included, which is what stops a second run re-sending the
            // same ones — a digest that repeats itself is worse than no
            // digest, because people stop reading it.
            $table->timestamp('notifications_emailed_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('users', fn (Blueprint $table) => $table->dropColumn(['notification_emails', 'notifications_emailed_at']));
    }
};
