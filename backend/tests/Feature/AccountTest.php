<?php

namespace Tests\Feature;

use App\Models\ModerationAction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The two branches of account deletion an end-to-end run can't reach: a
 * social-only account (no OAuth provider is configured in a test run) and
 * a staff account (nothing in the suites is staff *and* deleting itself).
 */
class AccountTest extends TestCase
{
    use RefreshDatabase;

    private function socialOnlyAccount(): User
    {
        $user = User::create(['name' => 'Pro Vider', 'email' => 'social@example.com', 'username' => 'pro-vider']);
        $user->socialAccounts()->create(['provider' => 'google', 'provider_user_id' => 'g-1']);

        return $user;
    }

    public function test_an_account_with_no_password_confirms_by_username(): void
    {
        $user = $this->socialOnlyAccount();

        $this->actingAs($user)->deleteJson('/api/account', ['confirm_username' => 'not-my-handle'])->assertStatus(422);
        $this->assertDatabaseHas('users', ['id' => $user->id]);

        $this->actingAs($user)->deleteJson('/api/account', ['confirm_username' => 'pro-vider'])->assertOk();
        $this->assertDatabaseMissing('users', ['id' => $user->id]);
    }

    public function test_the_account_endpoint_says_whether_a_password_exists(): void
    {
        $this->actingAs($this->socialOnlyAccount())->getJson('/api/auth/me')->assertOk()->assertJson(['has_password' => false]);
    }

    /**
     * A staff account's rows in moderation_actions cascade with it, so
     * self-service deletion would punch holes in the audit trail. It's a
     * deliberate act at the console instead.
     */
    public function test_a_staff_account_cannot_delete_itself(): void
    {
        $staff = User::create([
            'name' => 'Mod Erator',
            'email' => 'mod@example.com',
            'username' => 'mod-erator',
            'password' => 'password123',
        ]);
        $staff->is_staff = true;
        $staff->save();

        ModerationAction::create([
            'actor_id' => $staff->id,
            'action' => 'takedown',
            'target_type' => User::class,
            'target_id' => '999',
            'reason' => 'Something happened.',
        ]);

        $this->actingAs($staff)->deleteJson('/api/account', ['password' => 'password123'])->assertStatus(422);

        $this->assertDatabaseHas('users', ['id' => $staff->id]);
        $this->assertDatabaseCount('moderation_actions', 1);
    }

    public function test_the_export_includes_linked_social_accounts(): void
    {
        $user = $this->socialOnlyAccount();
        $user->socialAccounts()->first()->update(['email' => 'social@example.com', 'avatar' => 'https://example.com/a.png']);

        $body = $this->actingAs($user)->getJson('/api/account/export')->assertOk()->json();

        $this->assertCount(1, $body['social_accounts']);
        $this->assertSame('google', $body['social_accounts'][0]['provider']);
        $this->assertSame('g-1', $body['social_accounts'][0]['provider_user_id']);
        $this->assertSame('social@example.com', $body['social_accounts'][0]['email']);
    }

    public function test_deleting_takes_the_accounts_content_with_it(): void
    {
        $user = User::create([
            'name' => 'Lea Ving',
            'email' => 'leaving@example.com',
            'username' => 'lea-ving',
            'password' => 'password123',
        ]);
        $user->appeals()->create(['message' => 'A message long enough to be valid.']);

        $this->actingAs($user)->deleteJson('/api/account', ['password' => 'password123'])->assertOk();

        $this->assertDatabaseCount('appeals', 0);
        $this->assertDatabaseCount('personal_access_tokens', 0);
    }
}
