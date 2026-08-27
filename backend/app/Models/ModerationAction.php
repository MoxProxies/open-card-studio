<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** One entry in the moderation audit trail — see the migration. */
class ModerationAction extends Model
{
    use HasFactory;

    protected $fillable = ['actor_id', 'action', 'target_type', 'target_id', 'reason'];

    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_id');
    }

    public function toArray(): array
    {
        return [
            'id' => $this->id,
            'action' => $this->action,
            'target_type' => $this->target_type,
            'target_id' => $this->target_id,
            'reason' => $this->reason,
            'at' => $this->created_at,
            'actor' => $this->relationLoaded('actor') ? $this->actor?->name : null,
        ];
    }
}
