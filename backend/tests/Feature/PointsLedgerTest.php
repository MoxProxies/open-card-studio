<?php

namespace Tests\Feature;

use App\Models\PointEvent;
use App\Models\Template;
use App\Models\User;
use App\Support\PointsLedger;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class PointsLedgerTest extends TestCase
{
    use RefreshDatabase;

    private function account(string $email): User
    {
        return User::create([
            'name' => str($email)->before('@')->headline()->toString(),
            'email' => $email,
            'username' => str($email)->before('@')->toString(),
            'password' => 'password123',
        ]);
    }

    private function template(User $owner): Template
    {
        return Template::create([
            'id' => (string) Str::uuid(),
            'user_id' => $owner->id,
            'name' => 'Takedown target',
            'visibility' => 'published',
            'tags' => [],
            'design' => ['schemaVersion' => 1],
        ]);
    }

    public function test_reverse_for_negates_every_award_the_content_earned(): void
    {
        $owner = $this->account('owner@example.com');
        $reactor = $this->account('reactor@example.com');
        $template = $this->template($owner);

        PointsLedger::award($owner, 'reaction_received', $template, "reaction:template:{$template->id}:{$reactor->id}");
        PointsLedger::reverseFor($template);

        $this->assertSame(0, PointsLedger::total($owner));
        $this->assertDatabaseCount('point_events', 2);
    }

    public function test_reversing_twice_does_not_double_subtract(): void
    {
        $owner = $this->account('owner2@example.com');
        $reactor = $this->account('reactor2@example.com');
        $template = $this->template($owner);

        PointsLedger::award($owner, 'reaction_received', $template, "reaction:template:{$template->id}:{$reactor->id}");
        PointsLedger::reverseFor($template);
        PointsLedger::reverseFor($template);

        $this->assertSame(0, PointsLedger::total($owner));
        $this->assertDatabaseCount('point_events', 2);
    }

    public function test_a_raced_reversal_that_loses_the_create_is_a_harmless_no_op_not_a_500(): void
    {
        $owner = $this->account('owner3@example.com');
        $reactor = $this->account('reactor3@example.com');
        $template = $this->template($owner);

        $award = PointsLedger::award($owner, 'reaction_received', $template, "reaction:template:{$template->id}:{$reactor->id}");

        $raced = false;
        $dedupeKey = "reversal:{$award->id}";

        // Fires inside reverseFor()'s own PointEvent::create() call — after
        // it decided the reversal doesn't exist yet, but before its own row
        // lands. Creating it here reproduces exactly what a second,
        // concurrent takedown of the same content would do.
        PointEvent::creating(function (PointEvent $event) use (&$raced, $dedupeKey) {
            if ($raced || $event->dedupe_key !== $dedupeKey) {
                return;
            }

            $raced = true;
            PointEvent::create([
                'user_id' => $event->user_id,
                'amount' => $event->amount,
                'reason' => $event->reason,
                'source_type' => $event->source_type,
                'source_id' => $event->source_id,
                'dedupe_key' => $dedupeKey,
            ]);
        });

        // Without the fix this throws an uncaught QueryException: reverseFor()
        // used firstOrCreate(), a non-atomic read-then-write that the losing
        // side's create() blows through, hitting the unique index directly.
        PointsLedger::reverseFor($template);

        $this->assertTrue($raced);
        // Exactly one reversal row, not two — the losing side must not have
        // duplicated the reversal it was already too late to create.
        $this->assertSame(1, PointEvent::where('dedupe_key', $dedupeKey)->count());
        $this->assertSame(0, PointsLedger::total($owner));
    }
}
