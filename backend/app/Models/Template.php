<?php

namespace App\Models;

use App\Models\Concerns\OwnedByUser;
use App\Models\Concerns\Publishable;
use App\Models\Concerns\Reactable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A community-authored card layout: a scene-schema Design (the same JSON
 * blob card_designs stores) plus the publishing metadata around it —
 * owner, name, description, tags, visibility, usage count, version. See
 * docs/PRODUCT_VISION.md, "The architectural centerpiece: templates
 * reuse the existing lock model", for why there's no separate slot
 * schema: which layers are fixed chrome and which are fill-in slots is
 * already expressed by each layer's own `locked`/`contentLocked` flags
 * inside `design`, which this backend never parses.
 */
class Template extends Model
{
    use HasFactory, OwnedByUser, Publishable, Reactable;

    /** `usage_count` and `moderation_state` are deliberately absent: a
     * request can't claim a usage count for its own template, and
     * moderation state is staff-only. Both are written by code that names
     * the column explicitly (increment(), a future moderation action),
     * never by a validated request payload. */
    protected $fillable = [
        'id',
        'user_id',
        'name',
        'description',
        'tags',
        'visibility',
        'design',
        'version',
    ];

    protected function casts(): array
    {
        return [
            'featured_at' => 'datetime',
            'design' => 'array',
            'tags' => 'array',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** The template this one was remixed from, if any. Null once the
     * original is deleted — see the migration for why that's credit
     * disappearing rather than the fork breaking. */
    public function forkedFrom(): BelongsTo
    {
        return $this->belongsTo(self::class, 'forked_from_id');
    }

    /** Templates remixed from this one. Counted rather than stored, so
     * the number can't drift away from the rows it describes. */
    public function forks(): HasMany
    {
        return $this->hasMany(self::class, 'forked_from_id');
    }

    public function publishPointReason(): string
    {
        return 'template_published';
    }

    /**
     * The shape every endpoint returns for a template *without* its design
     * blob — a listing row. Includes the author's display name because
     * attribution isn't optional for community templates: PRODUCT_VISION's
     * liability section requires a community-authored layout to be clearly
     * attributed to the member who made it, never presented as first-party.
     */
    public function toSummary(): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'description' => $this->description,
            'tags' => $this->tags ?? [],
            'visibility' => $this->visibility,
            'usage_count' => $this->usage_count,
            'version' => $this->version,
            'updated_at' => $this->updated_at,
            'author' => [
                'id' => $this->user_id,
                'name' => $this->relationLoaded('user') ? $this->user?->name : null,
                'username' => $this->relationLoaded('user') ? $this->user?->username : null,
            ],
            // Attribution for a remix, on the same footing as the author's
            // own: PRODUCT_VISION's liability section is about a
            // community layout always naming who made it, and a remix has
            // two people to name.
            'forked_from' => $this->forked_from_id === null ? null : [
                'id' => $this->forked_from_id,
                'name' => $this->relationLoaded('forkedFrom') ? $this->forkedFrom?->name : null,
                'author' => $this->relationLoaded('forkedFrom') ? $this->forkedFrom?->user?->name : null,
                'username' => $this->relationLoaded('forkedFrom') ? $this->forkedFrom?->user?->username : null,
            ],
            // Only present where the caller asked for it (withCount).
            'fork_count' => $this->forks_count,
        ];
    }

    /** A listing row plus the design blob itself — what "use this template" fetches. */
    public function toDetail(): array
    {
        return $this->toSummary() + ['design' => $this->design];
    }
}
