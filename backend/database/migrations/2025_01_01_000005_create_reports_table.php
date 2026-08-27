<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('reports', function (Blueprint $table) {
            $table->id();
            // Polymorphic on purpose: designs, templates and users today,
            // collections and knowledge-base posts later, all through one
            // table and one endpoint rather than a reports_x table per
            // content type. reportable_id is a string because the ids it
            // points at are a mix of UUIDs (designs, templates) and
            // auto-increment ints (users).
            $table->string('reportable_type');
            $table->string('reportable_id');
            $table->foreignId('reporter_id')->constrained('users')->cascadeOnDelete();
            // Free-text-with-a-shortlist, same reasoning as template tags:
            // the shortlist is a UI affordance (ReportController::REASONS),
            // not a schema constraint, so adding a reason later doesn't
            // need a migration.
            $table->string('reason');
            $table->text('details')->nullable();
            // open | reviewed | actioned | dismissed. Nothing writes
            // anything but `open` yet — the queue that will is Phase 4/6
            // work. What has to exist now is the row it will read.
            $table->string('state')->default('open');
            $table->timestamps();

            $table->index(['reportable_type', 'reportable_id']);
            $table->index('state');
            // One report per person per thing: re-reporting updates the
            // existing row rather than letting one account inflate a count.
            $table->unique(['reportable_type', 'reportable_id', 'reporter_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('reports');
    }
};
