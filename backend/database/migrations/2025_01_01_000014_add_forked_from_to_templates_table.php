<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('templates', function (Blueprint $table) {
            // Remix lineage — the last thing docs/PRODUCT_VISION.md defers
            // out of Phase 1. A fork is a full copy (the design blob is
            // duplicated, not shared), so this column is credit, not a
            // dependency: deleting the original doesn't break anything
            // made from it.
            //
            // nullOnDelete rather than cascade for exactly that reason.
            // The fork survives; it just stops naming a parent, the same
            // way a printed card doesn't stop existing when its
            // inspiration goes offline.
            $table->uuid('forked_from_id')->nullable()->after('user_id');
            $table->foreign('forked_from_id')->references('id')->on('templates')->nullOnDelete();
            $table->index('forked_from_id');
        });
    }

    public function down(): void
    {
        Schema::table('templates', function (Blueprint $table) {
            $table->dropForeign(['forked_from_id']);
            $table->dropColumn('forked_from_id');
        });
    }
};
