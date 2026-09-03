<?php

namespace Tests\Feature;

use App\Models\Appeal;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * "One open appeal at a time" (AppealController::store()'s doc comment)
 * had never actually been backed by a database constraint — see this
 * migration: 2025_01_01_000018_add_one_open_appeal_per_user_index. This
 * proves the index itself does what it says, and that losing the race
 * against it comes back as a clean response rather than a 500.
 */
class AppealControllerTest extends TestCase
{
    use RefreshDatabase;

    private function suspendedAccount(string $email): User
    {
        $user = User::create([
            'name' => str($email)->before('@')->headline()->toString(),
            'email' => $email,
            'username' => str($email)->before('@')->toString(),
            'password' => 'password123',
        ]);
        $user->moderation_state = User::SUSPENDED;
        $user->save();

        return $user;
    }

    public function test_the_index_rejects_a_second_open_appeal_for_the_same_user(): void
    {
        $user = $this->suspendedAccount('constraint@example.com');

        Appeal::create(['user_id' => $user->id, 'message' => 'First appeal, long enough to be valid.']);

        $this->expectException(QueryException::class);
        DB::table('appeals')->insert([
            'user_id' => $user->id,
            'message' => 'Second appeal, long enough to be valid.',
            'state' => Appeal::OPEN,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /**
     * A denied appeal isn't open, so filing again afterwards must still
     * work — the index only constrains *open* appeals, not appeals in
     * general.
     */
    public function test_the_index_allows_a_new_appeal_once_the_previous_one_is_resolved(): void
    {
        $user = $this->suspendedAccount('resolved@example.com');
        $first = Appeal::create(['user_id' => $user->id, 'message' => 'First appeal, long enough to be valid.']);
        $first->state = 'denied';
        $first->save();

        DB::table('appeals')->insert([
            'user_id' => $user->id,
            'message' => 'Second appeal, long enough to be valid.',
            'state' => Appeal::OPEN,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->assertDatabaseCount('appeals', 2);
    }

    public function test_filing_a_second_open_appeal_through_the_endpoint_fails_cleanly_instead_of_500ing(): void
    {
        $user = $this->suspendedAccount('endpoint@example.com');

        $this->actingAs($user)
            ->postJson('/api/auth/appeal', ['message' => 'This was a misunderstanding and here is why.'])
            ->assertCreated();

        // The exists() check in store() already catches this in the
        // ordinary, unraced case — this is what it degrades to gracefully
        // if it didn't.
        $this->actingAs($user)
            ->postJson('/api/auth/appeal', ['message' => 'A second, different explanation entirely.'])
            ->assertStatus(422);

        $this->assertDatabaseCount('appeals', 1);
    }

    public function test_a_double_submit_that_loses_the_create_race_fails_cleanly_instead_of_500ing(): void
    {
        $user = $this->suspendedAccount('racer@example.com');
        $raced = false;

        // Fires inside this request's own Appeal::create() call — after
        // store()'s own exists() check already found no open appeal, but
        // before its row lands. Creating one here reproduces exactly what
        // a second, concurrent submission (two tabs, a retried request)
        // would do.
        Appeal::creating(function (Appeal $appeal) use (&$raced, $user) {
            if ($raced || $appeal->user_id !== $user->id) {
                return;
            }

            $raced = true;
            Appeal::create(['user_id' => $user->id, 'message' => 'The appeal that won the race, long enough.']);
        });

        // Without the fix this 500s: the exists() check and Appeal::create()
        // aren't atomic, and until the migration above there was no index
        // to catch it even if they raced.
        $this->actingAs($user)
            ->postJson('/api/auth/appeal', ['message' => 'The appeal that lost the race, long enough.'])
            ->assertStatus(422);

        $this->assertTrue($raced);
        $this->assertDatabaseCount('appeals', 1);
        $this->assertSame('The appeal that won the race, long enough.', Appeal::first()->message);
    }
}
