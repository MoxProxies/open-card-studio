<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\Request;

/**
 * The account's own feed of things that happened to it — see the
 * notifications migration for why this exists and why it isn't Laravel's
 * own notifications table.
 *
 * Read-only plus "mark read": nothing here creates a notification. That's
 * Notifier's job, called from wherever the thing actually happened, so a
 * client can never manufacture news about itself.
 */
class NotificationController extends Controller
{
    /** Newest first, capped. A feed nobody has read in a year is not
     * something to load in full to show a badge count. */
    private const LIMIT = 50;

    public function index(Request $request)
    {
        $user = $request->user();

        return response()->json([
            'notifications' => $user->notifications()->with('actor:id,name,username')->latest()->limit(self::LIMIT)->get(),
            // Counted separately from the page above: the unread badge has
            // to be right even when the unread ones fall outside it.
            'unread' => $user->notifications()->unread()->count(),
        ]);
    }

    /**
     * One-click unsubscribe from the email digest.
     *
     * Signed, unauthenticated and a plain GET, because that's what makes
     * it work from an email client in one click — the thing that makes
     * defaulting the digest on defensible. The address is hashed into the
     * signature so a forwarded link stops working once the address
     * changes.
     */
    public function unsubscribe(Request $request, int $id, string $hash)
    {
        $user = User::findOrFail($id);

        abort_unless(hash_equals(sha1($user->email), $hash), 403);

        $user->notification_emails = false;
        $user->save();

        return response()->json(['message' => 'You will not get notification emails. You can turn them back on in your profile.']);
    }

    /** Marks everything read, or one row when `id` is given. Scoped to the
     * caller's own rows, so someone else's id 404s rather than being
     * marked. */
    public function read(Request $request)
    {
        $data = $request->validate(['id' => ['sometimes', 'integer']]);
        $user = $request->user();

        if (isset($data['id'])) {
            // Assigned, not ->update([...]): `read_at` is deliberately
            // absent from Notification::$fillable, so mass assignment
            // silently drops it and the row stays unread. (The bulk path
            // below goes through the query builder, which isn't guarded —
            // which is exactly why only one of these two was broken.)
            $notification = $user->notifications()->whereKey($data['id'])->firstOrFail();
            $notification->read_at = now();
            $notification->save();
        } else {
            $user->notifications()->unread()->update(['read_at' => now()]);
        }

        return response()->json(['unread' => $user->notifications()->unread()->count()]);
    }
}
