<?php

namespace App\Models\Concerns;

use App\Models\Reaction;
use App\Models\User;
use Illuminate\Database\Eloquent\Relations\MorphMany;

/**
 * What a likeable thing gets. Designs, templates and collections use it
 * today; knowledge-base posts join in Phase 5 by adding one `use` line,
 * which is the whole point of the polymorphic table.
 *
 * Also carries `featured_at`, since the two travel together: featuring is
 * something an owner does to publishable content, and every type that can
 * be reacted to can also be featured.
 */
trait Reactable
{
    public function reactions(): MorphMany
    {
        return $this->morphMany(Reaction::class, 'reactable');
    }

    /** Whether `$user` has already reacted — null user (signed out) is false, not an error. */
    public function isReactedBy(?User $user): bool
    {
        return $user !== null && $this->reactions()->where('user_id', $user->id)->exists();
    }

    /** The two numbers every listing row needs, in the shape the API returns them. */
    public function reactionState(?User $viewer): array
    {
        return [
            // reactions_count when the caller eager-loaded withCount, a
            // query otherwise — so a listing can avoid N+1 but a single
            // fetch still works without ceremony.
            'reaction_count' => $this->reactions_count ?? $this->reactions()->count(),
            'reacted' => $this->isReactedBy($viewer),
            'featured' => $this->featured_at !== null,
        ];
    }

    public function scopeFeatured($query)
    {
        return $query->whereNotNull('featured_at');
    }
}
