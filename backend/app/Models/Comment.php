<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphTo;

/** Polymorphic like reactions and reports — comments live on posts today
 * and could attach to a design or template later without a second table. */
class Comment extends Model
{
    use HasFactory;

    protected $fillable = ['commentable_type', 'commentable_id', 'user_id', 'body'];

    public function commentable(): MorphTo
    {
        return $this->morphTo();
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** Same rule as everything else: a removed row is invisible to everyone. */
    public function scopeVisibleToPublic(Builder $query): Builder
    {
        return $query->where('moderation_state', '!=', 'removed');
    }

    public function toArray(): array
    {
        return [
            'id' => $this->id,
            'body' => $this->body,
            'created_at' => $this->created_at,
            'author' => [
                'id' => $this->user_id,
                'name' => $this->relationLoaded('user') ? $this->user?->name : null,
                'username' => $this->relationLoaded('user') ? $this->user?->username : null,
            ],
        ];
    }
}
