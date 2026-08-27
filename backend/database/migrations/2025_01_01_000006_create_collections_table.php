<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Same shape as card_designs and templates — client UUID key,
        // owner, name, visibility, moderation_state — because a collection
        // is the same kind of thing: user-owned content that can be
        // published. See App\Models\Concerns\OwnedByUser / Publishable.
        Schema::create('collections', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->text('description')->nullable();
            $table->string('visibility')->default('private');
            $table->string('moderation_state')->default('ok');
            $table->timestamps();

            $table->index(['visibility', 'moderation_state']);
        });

        // Laravel's conventional pivot name for CardDesign <-> Collection
        // (the two model names, singular, in alphabetical order), so
        // belongsToMany needs no configuration beyond the pivot columns.
        Schema::create('card_design_collection', function (Blueprint $table) {
            $table->id();
            $table->foreignUuid('collection_id')->constrained('collections')->cascadeOnDelete();
            $table->foreignUuid('card_design_id')->constrained('card_designs')->cascadeOnDelete();
            // Hand-ordered: a binder page or a deck list has an order its
            // owner chose, not just an insertion timestamp.
            $table->unsignedInteger('position')->default(0);
            $table->timestamps();

            $table->unique(['collection_id', 'card_design_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('card_design_collection');
        Schema::dropIfExists('collections');
    }
};
