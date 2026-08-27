<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\CardDesign;
use App\Models\Collection;
use App\Models\Comment;
use App\Models\Post;
use App\Models\Report;
use App\Models\Template;
use App\Models\Upload;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * One report endpoint for every content type, backed by one polymorphic
 * table — see the Report model. Filing a report is all this does: it
 * doesn't hide anything, doesn't notify anyone, and doesn't change a
 * moderation state. The queue that acts on these rows is Phase 4/6 work
 * (docs/PRODUCT_VISION.md); what matters now is that public content
 * shipped with somewhere for a complaint to go.
 */
class ReportController extends Controller
{
    /** What a client may report. Keyed by the short name the API takes. */
    private const REPORTABLE = [
        'template' => Template::class,
        'design' => CardDesign::class,
        'collection' => Collection::class,
        'user' => User::class,
        'post' => Post::class,
        'comment' => Comment::class,
        // Art is reportable in its own right, not only through whatever
        // design happens to show it: the same image can sit in several,
        // and taking it down once should settle it everywhere.
        'upload' => Upload::class,
    ];

    /** A shortlist for the UI, not a schema constraint — the column is free text. */
    public const REASONS = ['infringement', 'inappropriate', 'spam', 'impersonation', 'other'];

    public function store(Request $request)
    {
        $data = $request->validate([
            'type' => ['required', Rule::in(array_keys(self::REPORTABLE))],
            'id' => ['required', 'string', 'max:255'],
            'reason' => ['required', Rule::in(self::REASONS)],
            'details' => ['sometimes', 'nullable', 'string', 'max:2000'],
        ]);

        $model = self::REPORTABLE[$data['type']];

        // 404 for something that doesn't exist rather than storing a report
        // pointing at nothing — and note this deliberately doesn't check
        // whether the *reporter* can see it: an unlisted template someone
        // was sent a link to is exactly the kind of thing worth reporting.
        abort_unless($model::whereKey($data['id'])->exists(), 404);

        // updateOrCreate against the unique index: re-reporting the same
        // thing edits your existing report instead of stacking duplicates.
        $report = Report::updateOrCreate(
            ['reportable_type' => $model, 'reportable_id' => $data['id'], 'reporter_id' => $request->user()->id],
            ['reason' => $data['reason'], 'details' => $data['details'] ?? null],
        );

        // refresh() so `state` reports the database default rather than the
        // null an in-memory model carries for a column it didn't set — same
        // reason TemplateController::upsert refreshes.
        return response()->json($report->refresh()->only(['id', 'state']), 201);
    }
}
