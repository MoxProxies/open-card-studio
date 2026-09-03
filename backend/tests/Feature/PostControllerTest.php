<?php

namespace Tests\Feature;

use App\Models\Post;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * PostController::upsert()'s write can lose either of two different races
 * to the same shape of unique-index collision — see PostController's
 * upsertPost() doc comment:
 *
 *  - **The id**, on a PUT from a different account than the one that
 *    actually landed first — see CardDesignControllerTest's doc comment
 *    for why this is the case that still needs a guard (a same-account
 *    double-submit is already self-healed by Eloquent's own
 *    updateOrCreate()) and why these tests hook the query itself via
 *    DB::listen rather than a model event.
 *  - **The slug**, when two new posts whose titles slugify to the same
 *    value land at once — unlike the id, this race isn't self-healed by
 *    anything: Post::uniqueSlug()'s existence check and posts.slug's
 *    unique index are a different check-then-act pair than the one
 *    updateOrCreate() guards, keyed on a column updateOrCreate() never
 *    looks at.
 */
class PostControllerTest extends TestCase
{
    use RefreshDatabase;

    private function account(string $email = 'writer@example.com'): User
    {
        return User::create([
            'name' => 'Wri Ter',
            'email' => $email,
            'username' => str($email)->before('@')->toString(),
            'password' => 'password123',
        ]);
    }

    public function test_upserting_a_new_post_creates_it(): void
    {
        $user = $this->account();
        $id = (string) Str::uuid();

        $this->actingAs($user)->putJson("/api/posts/{$id}", [
            'title' => 'My Guide',
            'body' => 'Body text long enough to be a post.',
        ])->assertCreated()->assertJson(['title' => 'My Guide', 'slug' => 'my-guide']);

        $this->assertDatabaseHas('posts', ['id' => $id, 'user_id' => $user->id, 'slug' => 'my-guide']);
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
        // Creating the owner's row here (with a *different* title/slug,
        // so this stays a pure id collision) reproduces exactly what a
        // second, concurrent PUT with the same id from a different
        // account would do.
        DB::listen(function ($query) use (&$raced, $id, $owner) {
            if ($raced || ! str_contains($query->sql, '"id" = ?') || ! str_contains($query->sql, 'from "posts"')) {
                return;
            }

            $raced = true;
            DB::table('posts')->insert([
                'id' => $id, 'user_id' => $owner->id, 'title' => 'Owner Post', 'slug' => 'owner-post',
                'body' => 'Owner body.', 'category' => 'general', 'tags' => json_encode([]),
                'visibility' => 'private', 'moderation_state' => 'ok',
                'created_at' => now(), 'updated_at' => now(),
            ]);
        });

        // Without the fix this 500s: updateOrCreate()'s own read-then-write
        // hits the primary key directly, and its retry can't find a row
        // scoped to a different user_id.
        $this->actingAs($intruder)->putJson("/api/posts/{$id}", [
            'title' => 'Intruder Post',
            'body' => 'Intruder body long enough.',
        ])->assertStatus(409);

        $this->assertTrue($raced);
        $this->assertDatabaseCount('posts', 1);
        $this->assertSame('Owner Post', Post::findOrFail($id)->title);
    }

    public function test_two_new_posts_with_the_same_title_that_race_the_slug_get_different_slugs_not_a_500(): void
    {
        $user = $this->account();
        $id = (string) Str::uuid();
        $winnerId = (string) Str::uuid();
        $raced = false;

        // Fires on Post::uniqueSlug()'s own existence check, inside this
        // request — after it already decided "my-guide" was free, but
        // before this request's own row lands. Creating a *different*
        // post with that slug here reproduces exactly what a second,
        // concurrent post with the same title would do.
        DB::listen(function ($query) use (&$raced, $winnerId, $user) {
            if ($raced || ! str_contains($query->sql, 'slug')) {
                return;
            }

            $raced = true;
            DB::table('posts')->insert([
                'id' => $winnerId, 'user_id' => $user->id, 'title' => 'My Guide', 'slug' => 'my-guide',
                'body' => 'Body from the request that won the race.', 'category' => 'general', 'tags' => json_encode([]),
                'visibility' => 'private', 'moderation_state' => 'ok',
                'created_at' => now(), 'updated_at' => now(),
            ]);
        });

        // Without the fix this 500s: PostController::upsert()'s
        // Post::updateOrCreate() hits posts.slug's unique index directly,
        // unguarded.
        $response = $this->actingAs($user)->putJson("/api/posts/{$id}", [
            'title' => 'My Guide',
            'body' => 'Body from the request that lost the race.',
        ])->assertCreated();

        $this->assertTrue($raced);
        // The loser gets bumped onto the next free slug rather than
        // failing outright or colliding with the winner's.
        $this->assertSame('my-guide-2', $response->json('slug'));
        $this->assertDatabaseCount('posts', 2);
        $this->assertSame('my-guide-2', Post::findOrFail($id)->slug);
        $this->assertSame('my-guide', Post::findOrFail($winnerId)->slug);
    }
}
