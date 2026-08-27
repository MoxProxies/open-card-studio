<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A superseded version of a post, written *before* each edit lands. Not
 * a user-facing feature so much as a moderation one: once content is
 * public and community-authored, "what did this say before it was
 * edited" has to be answerable, and it can't be answered retroactively.
 */
class PostRevision extends Model
{
    use HasFactory;

    protected $fillable = ['post_id', 'user_id', 'title', 'body'];

    public function post(): BelongsTo
    {
        return $this->belongsTo(Post::class);
    }

    public function toArray(): array
    {
        return [
            'id' => $this->id,
            'title' => $this->title,
            'body' => $this->body,
            'saved_at' => $this->created_at,
        ];
    }
}
