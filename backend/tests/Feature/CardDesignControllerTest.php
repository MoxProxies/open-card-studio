<?php

namespace Tests\Feature;

use App\Models\CardDesign;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * The primary-key race OwnedByUser::updateOrCreateOwned() guards.
 *
 * abortIfOwnedByAnotherUser()'s existence check and the eventual write
 * aren't atomic, so two truly-simultaneous PUTs carrying the same
 * client-generated id — two different accounts choosing the same id,
 * "vanishingly unlikely with a real UUID but trivial to send on purpose"
 * per that method's own doc comment — can both pass the check and then
 * both try to INSERT the same primary key.
 *
 * A double-submit of the *same* id by the *same* account turns out not to
 * need this guard at all: Eloquent's own updateOrCreate() already
 * recovers from that case by itself (its internal createOrFirst() catches
 * the collision and re-queries by the same attributes, which still match
 * since it's the same user updating their own now-existing row) — see the
 * investigation in this codebase's commit message. The case that still
 * needs OwnedByUser::updateOrCreateOwned()'s manual catch is the one
 * where the *other* side of the race is a different account entirely, so
 * Eloquent's own re-query (scoped to *this* request's user_id) can't find
 * the row that actually landed and rethrows — that's what this test
 * reproduces, via a DB::listen hook rather than a model event (a model
 * event fired mid-request would land its insert *inside* the savepoint
 * Eloquent wraps the create attempt in, so it would be undone by the same
 * rollback as the failed insert — DB::listen fires on the query
 * abortIfOwnedByAnotherUser() itself issues, before any savepoint opens).
 */
class CardDesignControllerTest extends TestCase
{
    use RefreshDatabase;

    private function account(string $email = 'artist@example.com'): User
    {
        return User::create([
            'name' => 'Art Ist',
            'email' => $email,
            'username' => str($email)->before('@')->toString(),
            'password' => 'password123',
        ]);
    }

    public function test_upserting_a_new_design_creates_it(): void
    {
        $user = $this->account();
        $id = (string) Str::uuid();

        $this->actingAs($user)->putJson("/api/card-designs/{$id}", [
            'name' => 'My Card',
            'design' => ['schemaVersion' => 1],
        ])->assertOk()->assertJson(['name' => 'My Card']);

        $this->assertDatabaseHas('card_designs', ['id' => $id, 'user_id' => $user->id]);
    }

    public function test_a_raced_id_that_belongs_to_another_account_gets_a_clean_409_not_a_500(): void
    {
        $owner = $this->account('owner@example.com');
        $intruder = $this->account('intruder@example.com');
        $id = (string) Str::uuid();
        $raced = false;

        // Fires on abortIfOwnedByAnotherUser()'s own existence check,
        // inside the intruder's request — after it already found no row
        // for this id, but before this request's own write lands.
        // Creating the owner's row here reproduces exactly what a second,
        // concurrent PUT with the same id from a different account would
        // do.
        DB::listen(function ($query) use (&$raced, $id, $owner) {
            if ($raced || ! str_contains($query->sql, 'card_designs') || ! str_starts_with(ltrim($query->sql), 'select')) {
                return;
            }

            $raced = true;
            DB::table('card_designs')->insert([
                'id' => $id, 'user_id' => $owner->id, 'name' => 'Owner Design',
                'design' => json_encode(['schemaVersion' => 1]), 'visibility' => 'private',
                'created_at' => now(), 'updated_at' => now(),
            ]);
        });

        // Without the fix this 500s: updateOrCreate()'s own read-then-write
        // hits the primary key directly, and its retry can't find a row
        // scoped to a different user_id.
        $this->actingAs($intruder)->putJson("/api/card-designs/{$id}", [
            'name' => 'Intruder Design',
            'design' => ['schemaVersion' => 1],
        ])->assertStatus(409);

        $this->assertTrue($raced);
        $this->assertDatabaseCount('card_designs', 1);
        $this->assertSame('Owner Design', CardDesign::findOrFail($id)->name);
    }
}
