<?php

namespace App\Models;

use App\Models\Concerns\OwnedByUser;
use App\Models\Concerns\Publishable;
use App\Models\Concerns\Reactable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\MorphMany;
use Illuminate\Support\Str;

/**
 * A knowledge-base post — how to print at home, where to source card
 * stock, design tips. Like every other content type here it's owned,
 * publishable, reactable and reportable through the shared concerns; what
 * it adds is a slug, a category, edit history and comments.
 */
class Post extends Model
{
    use HasFactory, OwnedByUser, Publishable, Reactable;

    protected $fillable = ['id', 'user_id', 'title', 'slug', 'body', 'category', 'tags', 'visibility'];

    protected function casts(): array
    {
        return ['tags' => 'array', 'featured_at' => 'datetime'];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function revisions(): HasMany
    {
        return $this->hasMany(PostRevision::class)->latest();
    }

    public function comments(): MorphMany
    {
        return $this->morphMany(Comment::class, 'commentable')->oldest();
    }

    public function publishPointReason(): string
    {
        return 'post_published';
    }

    /**
     * A URL-safe slug that no other post holds. Generated once, from the
     * first title, and then left alone: a renamed post keeps its old URL
     * rather than silently breaking every link to it.
     */
    public static function uniqueSlug(string $title): string
    {
        $base = Str::limit(Str::slug($title), 60, '') ?: 'post';
        $slug = $base;

        for ($n = 2; static::where('slug', $slug)->exists(); $n++) {
            $slug = "{$base}-{$n}";
        }

        return $slug;
    }

    /** A listing row — no body, which can be long. */
    public function toSummary(): array
    {
        return [
            'id' => $this->id,
            'title' => $this->title,
            'slug' => $this->slug,
            'category' => $this->category,
            'category_label' => config("knowledge_base.categories.{$this->category}", $this->category),
            'tags' => $this->tags ?? [],
            'visibility' => $this->visibility,
            // First couple of lines, for a listing — computed rather than
            // stored so editing the body can't leave a stale excerpt.
            'excerpt' => Str::limit(trim(preg_replace('/[#>*`_\[\]]+/', '', $this->body)), 180),
            'updated_at' => $this->updated_at,
            'comment_count' => $this->comments_count ?? null,
            'author' => [
                'id' => $this->user_id,
                'name' => $this->relationLoaded('user') ? $this->user?->name : null,
                'username' => $this->relationLoaded('user') ? $this->user?->username : null,
            ],
        ];
    }

    public function toDetail(): array
    {
        return array_merge($this->toSummary(), [
            'body' => $this->body,
            'revision_count' => $this->revisions_count ?? $this->revisions()->count(),
        ]);
    }
}
