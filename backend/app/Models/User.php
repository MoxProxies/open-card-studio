<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

class User extends Authenticatable
{
    use HasApiTokens, HasFactory, Notifiable;

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

    /** Reports this user filed — not reports *about* them (those are
     * polymorphic; see the Report model). */
    public function reports(): HasMany
    {
        return $this->hasMany(Report::class, 'reporter_id');
    }

    /** Route-model binding for /api/users/{username}; suspended accounts 404. */
    public function scopePubliclyVisible(Builder $query): Builder
    {
        return $query->where('moderation_state', '!=', 'suspended');
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
