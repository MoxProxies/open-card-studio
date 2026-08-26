<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('card_designs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            // The scene-schema Design document (see packages/scene-schema in
            // the frontend workspace) exactly as the editor's getDesign()
            // produces it — this backend never parses or validates its
            // internal shape, just stores and returns it verbatim. Keeping
            // it opaque here is what lets the frontend's schema evolve
            // (new layer types, new fields) without a backend migration.
            $table->json('design');
            $table->string('visibility')->default('private');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('card_designs');
    }
};
