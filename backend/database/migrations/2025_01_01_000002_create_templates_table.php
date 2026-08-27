<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('templates', function (Blueprint $table) {
            // Same client-generated UUID story as card_designs (see that
            // migration's doc comment): "save as template" happens in the
            // editor, which already mints ids with crypto.randomUUID(), so
            // PUT-upsert-by-id is the only write verb here too.
            $table->uuid('id')->primary();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->text('description')->nullable();
            // Free-text tags, deliberately not an enum column or a lookup
            // table of franchises — see docs/PRODUCT_VISION.md's liability
            // section on why a curated/hardcoded list of "styles" is the
            // wrong shape here. A JSON array of short strings, normalized
            // (trimmed, lowercased, deduped) in TemplateController.
            $table->json('tags');
            // private | unlisted | published. Only `published` shows up in
            // the public browse endpoint; `unlisted` is fetchable by id
            // (a shareable link) but never listed.
            $table->string('visibility')->default('private');
            // A scene-schema Design document, byte-for-byte what the
            // editor's getDesign() produces — a Template *is* a Design plus
            // the publishing metadata around it (docs/PRODUCT_VISION.md,
            // "The architectural centerpiece"), so this column is stored
            // and returned as opaquely as card_designs.design is. Which
            // layers are fixed chrome and which are fill-in slots is
            // already encoded inside it, by the layers' own
            // locked/contentLocked flags — there is deliberately no
            // separate slot schema.
            $table->json('design');
            // Incremented by POST /api/templates/{id}/use — how many new
            // designs have been started from this template.
            $table->unsignedInteger('usage_count')->default(0);
            // Bumped by the owner on each save of an already-published
            // template, purely as a "this changed" marker for humans.
            // Migrating already-made designs when a template changes is
            // explicitly out of scope for Phase 1 (see PRODUCT_VISION.md)
            // — nothing reads this to transform anything.
            $table->unsignedInteger('version')->default(1);
            // ok | flagged | removed. Present from the first migration on
            // purpose: PRODUCT_VISION.md's non-negotiable constraints say
            // every user-generated content type needs an owner, a
            // visibility state, and a moderation/report path in the schema
            // it's born with, because retrofitting one after a public
            // community feature ships is much harder. The report queue and
            // takedown tooling that will drive this column are Phase 4/6
            // work; what has to exist now is the column a takedown can
            // write to — `removed` already hides a row from every listing
            // and fetch below.
            $table->string('moderation_state')->default('ok');
            $table->timestamps();

            // The browse endpoint's hot path: published, non-removed,
            // most-used/newest first.
            $table->index(['visibility', 'moderation_state']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('templates');
    }
};
