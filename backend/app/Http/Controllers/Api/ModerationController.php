<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Badge;
use App\Models\Comment;
use App\Models\ModerationAction;
use App\Models\Report;
use App\Models\User;
use App\Support\PointsLedger;
use App\Support\Reactable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Staff tooling: the report queue, takedowns, suspensions and manual
 * badge grants. Gated by EnsureStaff (which 404s rather than 403s — see
 * that middleware).
 *
 * Built as "the founders review a queue", which is the choice
 * docs/PRODUCT_VISION.md leaves open and the one that needs the least
 * tooling to be safe. Nothing here is automated: no auto-hiding at a
 * report threshold, no heuristics. A human reads a report and decides.
 * If that stops scaling, the queue is where automation would attach.
 *
 * Every action writes a ModerationAction row. That's the audit trail the
 * constraints section asks for, and it's why nothing here mutates
 * quietly.
 */
class ModerationController extends Controller
{
    /** What a takedown can point at — everything reportable except accounts,
     * which are suspended rather than removed. */
    private const TAKEDOWN_TYPES = [
        'template' => \App\Models\Template::class,
        'design' => \App\Models\CardDesign::class,
        'collection' => \App\Models\Collection::class,
        'post' => \App\Models\Post::class,
        'comment' => Comment::class,
    ];

    /** The queue. Open reports first, oldest first — a complaint that has
     * been waiting longest is the one most likely to matter. */
    public function reports(Request $request)
    {
        $params = $request->validate([
            'state' => ['sometimes', Rule::in(['open', 'reviewed', 'actioned', 'dismissed', 'all'])],
        ]);

        $query = Report::query()->with(['reporter:id,name,username', 'reportable'])->oldest();

        if (($params['state'] ?? 'open') !== 'all') {
            $query->where('state', $params['state'] ?? 'open');
        }

        return response()->json(
            $query->limit(100)->get()->map(fn (Report $report) => [
                'id' => $report->id,
                'reason' => $report->reason,
                'details' => $report->details,
                'state' => $report->state,
                'reported_at' => $report->created_at,
                'reporter' => ['id' => $report->reporter_id, 'name' => $report->reporter?->name],
                'target' => $this->describeTarget($report),
            ])
        );
    }

    /** Mark a report reviewed/actioned/dismissed. Doesn't touch the content —
     * a takedown is a separate, explicit call. */
    public function resolveReport(Request $request, int $id)
    {
        $data = $request->validate([
            'state' => ['required', Rule::in(['open', 'reviewed', 'actioned', 'dismissed'])],
            'reason' => ['sometimes', 'nullable', 'string', 'max:2000'],
        ]);

        $report = Report::findOrFail($id);
        // Assigned, not mass-assigned: `state` is deliberately absent from
        // Report::$fillable so a reporter can't file a pre-resolved report.
        // Same rule as is_staff and featured_at — staff-only columns aren't
        // fillable, and the staff endpoint sets them explicitly.
        $report->state = $data['state'];
        $report->save();

        $this->record($request, 'report_state', Report::class, (string) $report->id, $data['reason'] ?? "state → {$data['state']}");

        return response()->json(['id' => $report->id, 'state' => $report->state]);
    }

    /**
     * Remove content from view, or put it back. `removed` hides it from
     * everyone including its owner (see Publishable::scopeVisibleToPublic),
     * and cancels the points it earned — a template that turned out to be
     * someone else's art shouldn't keep paying for itself.
     */
    public function takedown(Request $request)
    {
        $data = $request->validate([
            'type' => ['required', Rule::in(array_keys(self::TAKEDOWN_TYPES))],
            'id' => ['required', 'string', 'max:255'],
            'removed' => ['required', 'boolean'],
            // Required on the way *in*: an audit trail of takedowns with no
            // stated reason is barely better than none.
            'reason' => ['required_if:removed,true', 'nullable', 'string', 'max:2000'],
        ]);

        $model = self::TAKEDOWN_TYPES[$data['type']];
        $content = $model::findOrFail($data['id']);

        $content->moderation_state = $data['removed'] ? 'removed' : 'ok';
        $content->save();

        if ($data['removed']) {
            PointsLedger::reverseFor($content);
        }

        $this->record($request, $data['removed'] ? 'takedown' : 'restore', $model, (string) $content->getKey(), $data['reason'] ?? null);

        return response()->json(['id' => $content->getKey(), 'moderation_state' => $content->moderation_state]);
    }

    /**
     * Suspend or reinstate an account. A suspension blocks every
     * authenticated request (BlockSuspendedUsers) and hides the profile;
     * it deliberately doesn't delete anything, so it's reversible and so
     * an appeal has something to look at.
     */
    public function suspend(Request $request, int $id)
    {
        $data = $request->validate([
            'suspended' => ['required', 'boolean'],
            'reason' => ['required_if:suspended,true', 'nullable', 'string', 'max:2000'],
        ]);

        $user = User::findOrFail($id);

        // Staff can't suspend staff or themselves. Two people arguing with
        // the suspend button is not a moderation process.
        abort_if($user->is_staff, 422, 'Staff accounts cannot be suspended through this endpoint.');

        $user->moderation_state = $data['suspended'] ? User::SUSPENDED : 'ok';
        $user->save();

        $this->record($request, $data['suspended'] ? 'suspend' : 'reinstate', User::class, (string) $user->id, $data['reason'] ?? null);

        return response()->json(['id' => $user->id, 'moderation_state' => $user->moderation_state]);
    }

    /**
     * Grant or revoke a manual badge — the half of the badge system that
     * was modelled from the start but had no way to be used until staff
     * existed (see BadgeController's note).
     */
    public function badge(Request $request, int $id)
    {
        $data = $request->validate([
            'badge' => ['required', 'string', 'exists:badges,id'],
            'granted' => ['required', 'boolean'],
            'reason' => ['sometimes', 'nullable', 'string', 'max:2000'],
        ]);

        $user = User::findOrFail($id);
        $badge = Badge::findOrFail($data['badge']);

        // Rule-based badges are the system's to give: hand-granting one
        // would be a lie about what it means, and the next evaluation
        // wouldn't agree with it.
        abort_if($badge->rule !== null, 422, "“{$badge->name}” is earned automatically and can't be granted by hand.");

        if ($data['granted']) {
            $user->badges()->syncWithoutDetaching([$badge->id => ['awarded_by' => $request->user()->id]]);
        } else {
            $user->badges()->detach($badge->id);
        }

        $this->record($request, $data['granted'] ? 'badge_grant' : 'badge_revoke', User::class, (string) $user->id, $data['reason'] ?? $badge->id);

        return response()->json(['id' => $user->id, 'badges' => $user->badges()->get()->map->toArray()]);
    }

    /** The audit trail, newest first. */
    public function actions(Request $request)
    {
        return response()->json(ModerationAction::with('actor:id,name')->latest()->limit(200)->get()->map->toArray());
    }

    /** Enough about the reported thing for a moderator to judge it without
     * hunting: what it is, who owns it, and its text. */
    private function describeTarget(Report $report): array
    {
        $target = $report->reportable;

        if (! $target) {
            return ['type' => class_basename($report->reportable_type), 'id' => $report->reportable_id, 'gone' => true];
        }

        $shortType = array_search($report->reportable_type, self::TAKEDOWN_TYPES, true) ?: ($target instanceof User ? 'user' : class_basename($target));

        return [
            'type' => $shortType,
            'id' => (string) $target->getKey(),
            'label' => $target->name ?? $target->title ?? mb_substr($target->body ?? '', 0, 120),
            'owner' => $target instanceof User ? $target->username : ($target->user_id ?? null),
            'moderation_state' => $target->moderation_state ?? null,
        ];
    }

    private function record(Request $request, string $action, string $targetType, string $targetId, ?string $reason): void
    {
        ModerationAction::create([
            'actor_id' => $request->user()->id,
            'action' => $action,
            'target_type' => $targetType,
            'target_id' => $targetId,
            'reason' => $reason,
        ]);
    }
}
