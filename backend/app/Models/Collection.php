<?php

namespace App\Models;

use App\Models\Concerns\OwnedByUser;
use App\Models\Concerns\Publishable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

/**
 * A named group of the owner's own designs — a binder, a deck, a set.
 * Deliberately almost no code of its own: ownership, the UUID key, the
 * visibility vocabulary and the moderation state all come from the same
 * two concerns card_designs and templates use, which was the point of
 * building this phase (docs/PRODUCT_VISION.md — it exists partly to check
 * those patterns generalize).
 */
class Collection extends Model
{
    use HasFactory, OwnedByUser, Publishable;

    protected $fillable = [
        'id',
        'user_id',
        'name',
        'description',
        'visibility',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** Ordered by the owner's chosen position — see the pivot migration. */
    public function cardDesigns(): BelongsToMany
    {
        return $this->belongsToMany(CardDesign::class)
            ->withPivot('position')
            ->withTimestamps()
            ->orderBy('position')
            ->orderBy('card_design_collection.id');
    }

    public function toSummary(): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'description' => $this->description,
            'visibility' => $this->visibility,
            // Present whenever the caller loaded a count or the relation;
            // null rather than a silent 0 when it loaded neither, so a UI
            // can tell "empty" from "not asked for".
            'design_count' => $this->design_count ?? ($this->relationLoaded('cardDesigns') ? $this->cardDesigns->count() : null),
            'updated_at' => $this->updated_at,
            'author' => [
                'id' => $this->user_id,
                'name' => $this->relationLoaded('user') ? $this->user?->name : null,
                'username' => $this->relationLoaded('user') ? $this->user?->username : null,
            ],
        ];
    }

    /**
     * A collection plus the designs in it. `$asOwner` decides which designs
     * are listed: a published collection is a public page, and the owner
     * may well have put private drafts in it — those stay hidden from
     * everyone else even though the collection itself is public.
     */
    public function toDetail(bool $asOwner): array
    {
        $designs = $this->cardDesigns
            ->filter(fn (CardDesign $design) => $asOwner || $design->isPubliclyReadable())
            ->values()
            ->map->toSummary();

        // array_merge, not `+`: the union operator keeps the *left* side's
        // value for a duplicate key, which would leave toSummary()'s
        // unfiltered design_count in place and quietly tell a stranger how
        // many private designs the collection really holds.
        return array_merge($this->toSummary(), ['designs' => $designs, 'design_count' => $designs->count()]);
    }
}
