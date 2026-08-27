<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            // Both encrypted at rest (see User::casts) — a database dump
            // that leaks TOTP secrets hands over the second factor for
            // every account in it, which is most of the point gone.
            // Text, not string: ciphertext is much longer than the 32
            // characters the secret itself takes.
            $table->text('two_factor_secret')->nullable();
            $table->text('two_factor_recovery_codes')->nullable();
            // Null until a code from the app has actually been checked.
            // A secret that exists but was never confirmed must not lock
            // anyone out: it's someone who opened the setup screen and
            // wandered off.
            $table->timestamp('two_factor_confirmed_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('users', fn (Blueprint $table) => $table->dropColumn([
            'two_factor_secret',
            'two_factor_recovery_codes',
            'two_factor_confirmed_at',
        ]));
    }
};
