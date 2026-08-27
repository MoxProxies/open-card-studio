<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A provider identity linked to an account. `provider_user_id` is the
 * identity — never `email`, which a user can change at the provider and
 * which some providers don't verify at all.
 */
class SocialAccount extends Model
{
    use HasFactory;

    protected $fillable = ['user_id', 'provider', 'provider_user_id', 'email', 'avatar', 'last_used_at'];

    protected function casts(): array
    {
        return ['last_used_at' => 'datetime'];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
