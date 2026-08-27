<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

class User extends Authenticatable
{
    use HasApiTokens, HasFactory, Notifiable;

    /**
     * The content types a user owns that can be reacted to — relation name
     * => model class. One list, so "everything this account has that
     * someone could like" is defined once instead of being re-enumerated
     * by every counter, profile and badge rule.
     */
    public const REACTABLE_OWNED = [
        'cardDesigns' => CardDesign::class,
        'templates' => Template::class,
        'collections' => Collection::class,
        'posts' => Post::class,
    ];

    public const SUSPENDED = 'suspended';

    protected $fillable = [
        'name',
        'email',
        'password',
        'username',
        'bio',
        'avatar_url',
    ];

    protected $hidden = [
        'password',
        'remember_token',
        // Never in an API response: `email` is on a public profile's model
        // too, and a profile is readable by anyone. The account's own
        // /api/auth/me adds it back explicitly (AuthController::me).
        'email',
    ];

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'is_staff' => 'boolean',
        ];
    }

    public function cardDesigns(): HasMany
    {
        return $this->hasMany(CardDesign::class);
    }

    public function templates(): HasMany
    {
        return $this->hasMany(Template::class);
    }

    public function collections(): HasMany
    {
        return $this->hasMany(Collection::class);
    }

    public function posts(): HasMany
    {
        return $this->hasMany(Post::class);
    }

    public function socialAccounts(): HasMany
    {
        return $this->hasMany(SocialAccount::class);
    }

    /** Appeals this account has filed against its own suspension. */
    public function appeals(): HasMany
    {
        return $this->hasMany(Appeal::class);
    }

    public function isSuspended(): bool
    {
        return $this->moderation_state === self::SUSPENDED;
    }

    /** False for an account created through a provider that has never set
     * one — password sign-in is refused with a message that says so
     * rather than a generic "wrong credentials". */
    public function hasPassword(): bool
    {
        return $this->password !== null;
    }

    public function pointEvents(): HasMany
    {
        return $this->hasMany(PointEvent::class);
    }

    public function badges(): BelongsToMany
    {
        return $this->belongsToMany(Badge::class)->withPivot('awarded_by')->withTimestamps();
    }

    public function reactions(): HasMany
    {
        return $this->hasMany(Reaction::class);
    }

    /** Reports this user filed — not reports *about* them (those are
     * polymorphic; see the Report model). */
    public function reports(): HasMany
    {
        return $this->hasMany(Report::class, 'reporter_id');
    }

    /** Route-model binding for /api/users/{username}; suspended accounts 404. */
    public function scopePubliclyVisible(Builder $query): Builder
    {
        return $query->where('moderation_state', '!=', self::SUSPENDED);
    }

    /** What anyone may see about this account. Deliberately not the model
     * itself: a profile is public, and `email` must never leak into one. */
    public function toPublicProfile(): array
    {
        return [
            'id' => $this->id,
            'username' => $this->username,
            'name' => $this->name,
            'bio' => $this->bio,
            'avatar_url' => $this->avatar_url,
            'joined_at' => $this->created_at,
        ];
    }
}
