<?php

namespace App\Models\Concerns;

use Illuminate\Database\Eloquent\Builder;

/**
 * One visibility vocabulary for every user-generated content type
 * (card_designs, templates — collections and posts next), plus the
 * moderation state that overrides it. card_designs originally called the
 * public state "public" and templates called it "published"; they're all
 * PUBLISHED now (see the add_moderation_state_to_card_designs migration).
 */
trait Publishable
{
    /** Only its owner. */
    public const PRIVATE = 'private';

    /** Reachable by id — a link its owner shared — but never listed. */
    public const UNLISTED = 'unlisted';

    /** Listed publicly: the gallery, the owner's profile. */
    public const PUBLISHED = 'published';

    public const VISIBILITIES = [self::PRIVATE, self::UNLISTED, self::PUBLISHED];

    /** Moderation states. `REMOVED` hides a row everywhere, its owner included. */
    public const MODERATION_OK = 'ok';

    public const MODERATION_FLAGGED = 'flagged';

    public const MODERATION_REMOVED = 'removed';

    /** Excludes rows a moderator has taken down. Every read path starts here. */
    public function scopeVisibleToPublic(Builder $query): Builder
    {
        return $query->where('moderation_state', '!=', self::MODERATION_REMOVED);
    }

    /** Listed-publicly rows only — the gallery and profile listings. */
    public function scopePublished(Builder $query): Builder
    {
        return $query->visibleToPublic()->where('visibility', self::PUBLISHED);
    }

    /** True when anyone holding the id may read this, owner or not. */
    public function isPubliclyReadable(): bool
    {
        return $this->moderation_state !== self::MODERATION_REMOVED
            && in_array($this->visibility, [self::PUBLISHED, self::UNLISTED], true);
    }
}
