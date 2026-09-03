<?php

namespace Tests\Feature;

use App\Models\Collection;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * The primary-key race OwnedByUser::updateOrCreateOwned() guards — see
 * CardDesignControllerTest's doc comment for the full shape of it,
 * including why a same-account double-submit doesn't need this guard
 * (Eloquent's own updateOrCreate() already recovers from that case) and
 * why this test hooks the query itself via DB::listen rather than a
 * model event.
 */
class CollectionControllerTest extends TestCase
{
    use RefreshDatabase;

    private function account(string $email = 'curator@example.com'): User
    {
        return User::create([
            'name' => 'Cur Ator',
            'email' => $email,
            'username' => str($email)->before('@')->toString(),
            'password' => 'password123',
        ]);
    }

    public function test_upserting_a_new_collection_creates_it(): void
    {
        $user = $this->account();
        $id = (string) Str::uuid();

        $this->actingAs($user)->putJson("/api/collections/{$id}", ['name' => 'My Collection'])
            ->assertCreated()
            ->assertJson(['name' => 'My Collection']);

        $this->assertDatabaseHas('collections', ['id' => $id, 'user_id' => $user->id]);
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
            if ($raced || ! str_contains($query->sql, 'collections') || ! str_starts_with(ltrim($query->sql), 'select')) {
                return;
            }

            $raced = true;
            DB::table('collections')->insert([
                'id' => $id, 'user_id' => $owner->id, 'name' => 'Owner Collection',
                'visibility' => 'private', 'moderation_state' => 'ok',
                'created_at' => now(), 'updated_at' => now(),
            ]);
        });

        // Without the fix this 500s: updateOrCreate()'s own read-then-write
        // hits the primary key directly, and its retry can't find a row
        // scoped to a different user_id.
        $this->actingAs($intruder)->putJson("/api/collections/{$id}", ['name' => 'Intruder Collection'])
            ->assertStatus(409);

        $this->assertTrue($raced);
        $this->assertDatabaseCount('collections', 1);
        $this->assertSame('Owner Collection', Collection::findOrFail($id)->name);
    }
}
