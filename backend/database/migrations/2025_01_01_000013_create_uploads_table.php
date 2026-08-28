<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Art used to live inside the design itself, as a base64 data URL
        // in the JSON blob — so every save, every API response and every
        // published template carried the whole image, re-encoded 33%
        // larger than the file it came from. This table is where it lives
        // instead; a design now references an upload by id.
        Schema::create('uploads', function (Blueprint $table) {
            // A UUID because the id *is* the access control: an upload is
            // served to anyone who has the URL (art in a published design
            // has to load for everyone), so the id has to be unguessable.
            $table->uuid('id')->primary();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            // art | avatar. Not a constraint — the difference is what the
            // app does with it, and a new kind shouldn't need a migration.
            $table->string('kind');
            $table->string('mime');
            // Of the *stored* file, after re-encoding and downscaling —
            // which is what the quota is counted against, since it's what
            // the disk actually holds.
            $table->unsignedInteger('bytes');
            $table->unsignedInteger('width');
            $table->unsignedInteger('height');
            // sha256 of the stored bytes. Uploading the same file twice
            // returns the first row rather than spending the quota again.
            $table->string('checksum', 64);
            // Same vocabulary as every other piece of user content: staff
            // can take an image down, and a removed one stops being served.
            $table->string('moderation_state')->default('ok');
            $table->timestamps();

            $table->index(['user_id', 'created_at']);
            $table->unique(['user_id', 'checksum']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('uploads');
    }
};
