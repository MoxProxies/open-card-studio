<?php

namespace Tests\Feature;

use App\Models\Report;
use App\Models\Template;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * ReportController::store()'s updateOrCreate() against reports' composite
 * unique index turned out not to need a manual duplicate-key guard: two
 * reports for the same (type, id, reporter) racing at once is already
 * handled by Eloquent's own updateOrCreate() → firstOrCreate() →
 * createOrFirst(), which catches exactly this collision internally and
 * re-queries by the same attributes it searched on in the first place —
 * see the investigation this codebase's commit message for
 * PostController/OwnedByUser records. This just proves the ordinary,
 * unraced re-report path updates in place rather than duplicating.
 */
class ReportControllerTest extends TestCase
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
            'name' => 'Reportable',
            'visibility' => 'published',
            'tags' => [],
            'design' => ['schemaVersion' => 1],
        ]);
    }

    public function test_reporting_the_same_thing_twice_updates_the_existing_report(): void
    {
        $owner = $this->account('owner@example.com');
        $reporter = $this->account('reporter@example.com');
        $template = $this->template($owner);

        $this->actingAs($reporter)->postJson('/api/reports', ['type' => 'template', 'id' => $template->id, 'reason' => 'spam'])
            ->assertCreated();

        $this->actingAs($reporter)->postJson('/api/reports', ['type' => 'template', 'id' => $template->id, 'reason' => 'infringement'])
            ->assertCreated();

        $this->assertDatabaseCount('reports', 1);
        $this->assertSame('infringement', Report::first()->reason);
    }
}
