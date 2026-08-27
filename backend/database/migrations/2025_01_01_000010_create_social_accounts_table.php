<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('social_accounts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            // google | github — see config/services.php. A row per provider
            // per user, so one account can have several linked and signing
            // in with any of them lands on the same account.
            $table->string('provider');
            $table->string('provider_user_id');
            // What the provider told us at the last sign-in, kept for
            // support ("which Google account is this?"), never used to
            // authenticate — provider_user_id is the identity.
            $table->string('email')->nullable();
            $table->string('avatar')->nullable();
            $table->timestamp('last_used_at')->nullable();
            $table->timestamps();

            // The identity key. Two users can never claim the same
            // provider account, and a repeat sign-in updates rather than
            // duplicates.
            $table->unique(['provider', 'provider_user_id']);
            $table->index('user_id');
        });

        // A social-only account has no password to store. Nullable rather
        // than a random unusable one: a null is honest about there being
        // no password, and AuthController::login checks for it explicitly
        // rather than relying on a hash nobody can produce.
        Schema::table('users', function (Blueprint $table) {
            $table->string('password')->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('social_accounts');
    }
};
