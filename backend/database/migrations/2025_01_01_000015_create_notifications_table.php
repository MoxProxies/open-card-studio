<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Everything the community half of this app does — likes, comments,
        // remixes, badges, moderation decisions — happened silently to the
        // person it happened to. This is where they find out.
        //
        // Deliberately not Laravel's own `notifications` table: that one is
        // built around queued channel delivery (mail, broadcast, database)
        // and a serialized notification class per row. What's needed here
        // is a feed the app reads back and renders, which is a different
        // shape and a much smaller one.
        Schema::create('notifications', function (Blueprint $table) {
            $table->id();
            // Who is being told.
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            // reaction | comment | remix | badge | moderation | appeal
            $table->string('type');
            // Who did it. Null for anything the system did on its own (a
            // badge, an automated award), and nulled rather than cascaded
            // when that account is deleted — the thing still happened.
            $table->foreignId('actor_id')->nullable()->constrained('users')->nullOnDelete();
            // What it happened to. Polymorphic and string-keyed for the
            // same reason reports are: the ids are a mix of UUIDs and
            // auto-increment ints.
            $table->string('subject_type')->nullable();
            $table->string('subject_id')->nullable();
            // Enough to render the row without loading the subject —
            // which may since have been deleted.
            $table->json('data')->nullable();
            $table->timestamp('read_at')->nullable();
            $table->timestamps();

            // Exactly-once, the same way point awards are: unliking and
            // re-liking must not produce a second notification, and a
            // retried request must not either.
            $table->string('dedupe_key')->nullable()->unique();
            $table->index(['user_id', 'read_at']);
            $table->index(['user_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('notifications');
    }
};
