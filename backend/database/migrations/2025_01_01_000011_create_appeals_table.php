<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // A suspended account being told "you're suspended, contact
        // support" with no route to contest it was the gap
        // docs/PRODUCT_VISION.md left open at the end of Phase 6. This is
        // that route: the suspended user writes one appeal, staff read it
        // in the same queue they read reports in, and granting it
        // reinstates the account.
        Schema::create('appeals', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->text('message');
            // open | granted | denied
            $table->string('state')->default('open');
            // What the moderator wrote back. The appellant sees this, so
            // it's the one field here written for them rather than about
            // them.
            $table->text('response')->nullable();
            // Nullable so an appeal survives the staff account that
            // resolved it being deleted — the decision still happened.
            $table->foreignId('resolved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('resolved_at')->nullable();
            $table->timestamps();

            $table->index(['state', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('appeals');
    }
};
