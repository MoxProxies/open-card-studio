<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            // The staff flag every moderation endpoint checks. A boolean,
            // not a roles table: there is exactly one privileged role
            // ("can moderate"), and inventing a permission system for one
            // role is the kind of thing you regret in both directions.
            // Granted from tinker — see the moderation README section.
            $table->boolean('is_staff')->default(false);
        });

        // The audit trail docs/PRODUCT_VISION.md asks for. Append-only,
        // like the points ledger and for the same reason: a moderation
        // decision that can be quietly edited afterwards isn't an audit
        // trail. Undoing an action is a new row, not a delete.
        Schema::create('moderation_actions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('actor_id')->constrained('users')->cascadeOnDelete();
            // takedown | restore | suspend | reinstate | report_state |
            // badge_grant | badge_revoke
            $table->string('action');
            $table->string('target_type');
            $table->string('target_id');
            // Free text from the moderator. Not optional for a takedown or
            // a suspension — see ModerationController.
            $table->text('reason')->nullable();
            $table->timestamps();

            $table->index(['target_type', 'target_id']);
            $table->index('created_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('moderation_actions');
        Schema::table('users', fn (Blueprint $table) => $table->dropColumn('is_staff'));
    }
};
