<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Comment;
use App\Models\Post;
use App\Support\Notifier;
use Illuminate\Http\Request;

/**
 * Comments on a post. Polymorphic underneath (see the Comment model), but
 * only posts expose them today — a comment thread on a card design is a
 * product decision nobody has made yet.
 */
class CommentController extends Controller
{
    public function index(string $slug)
    {
        $post = Post::publiclyReadable()->where('slug', $slug)->firstOrFail();

        return response()->json($post->comments()->visibleToPublic()->with('user:id,name,username')->get()->map->toArray());
    }

    public function store(Request $request, string $slug)
    {
        $data = $request->validate(['body' => ['required', 'string', 'max:4000']]);

        // Only on a post you could actually read. An unlisted post someone
        // shared a link to is fair game; a private draft isn't.
        $post = Post::publiclyReadable()->where('slug', $slug)->firstOrFail();

        $comment = $post->comments()->create(['user_id' => $request->user()->id, 'body' => $data['body']]);

        // No dedupe key: two comments from the same person on the same
        // post really are two things to hear about, unlike two likes.
        Notifier::notify($post->user, 'comment', $request->user(), $post, ['title' => $post->title]);

        return response()->json($comment->load('user:id,name,username')->toArray(), 201);
    }

    /**
     * A commenter can delete their own comment; so can the author of the
     * post it's on, since a thread on your own guide is yours to keep
     * clean. Anyone else gets a 404.
     */
    public function destroy(Request $request, int $id)
    {
        $comment = Comment::with('commentable')->findOrFail($id);
        $isPostAuthor = $comment->commentable && $comment->commentable->user_id === $request->user()->id;

        abort_if($comment->user_id !== $request->user()->id && ! $isPostAuthor, 404);

        $comment->delete();

        return response()->noContent();
    }
}
