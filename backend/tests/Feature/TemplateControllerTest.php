<?php

namespace Tests\Feature;

use App\Models\Template;
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
class TemplateControllerTest extends TestCase
{
    use RefreshDatabase;

    private function account(string $email = 'creator@example.com'): User
    {
        return User::create([
            'name' => 'Cre Ator',
            'email' => $email,
            'username' => str($email)->before('@')->toString(),
            'password' => 'password123',
        ]);
    }

    public function test_upserting_a_new_template_creates_it(): void
    {
        $user = $this->account();
        $id = (string) Str::uuid();

        $this->actingAs($user)->putJson("/api/templates/{$id}", [
            'name' => 'My Template',
            'design' => ['schemaVersion' => 1],
        ])->assertCreated()->assertJson(['name' => 'My Template']);

        $this->assertDatabaseHas('templates', ['id' => $id, 'user_id' => $user->id]);
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
            if ($raced || ! str_contains($query->sql, 'templates') || ! str_starts_with(ltrim($query->sql), 'select')) {
                return;
            }

            $raced = true;
            DB::table('templates')->insert([
                'id' => $id, 'user_id' => $owner->id, 'name' => 'Owner Template',
                'tags' => json_encode([]), 'design' => json_encode(['schemaVersion' => 1]),
                'visibility' => 'private', 'moderation_state' => 'ok',
                'usage_count' => 0, 'version' => 1,
                'created_at' => now(), 'updated_at' => now(),
            ]);
        });

        // Without the fix this 500s: updateOrCreate()'s own read-then-write
        // hits the primary key directly, and its retry can't find a row
        // scoped to a different user_id.
        $this->actingAs($intruder)->putJson("/api/templates/{$id}", [
            'name' => 'Intruder Template',
            'design' => ['schemaVersion' => 1],
        ])->assertStatus(409);

        $this->assertTrue($raced);
        $this->assertDatabaseCount('templates', 1);
        $this->assertSame('Owner Template', Template::findOrFail($id)->name);
    }
}
