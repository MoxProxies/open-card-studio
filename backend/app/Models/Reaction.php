<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphTo;

/** A like on any content type — see the migration for why it's one table. */
class Reaction extends Model
{
    use HasFactory;

    public const LIKE = 'like';

    protected $fillable = ['reactable_type', 'reactable_id', 'user_id', 'type'];

    public function reactable(): MorphTo
    {
        return $this->morphTo();
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
