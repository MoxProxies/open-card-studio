<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphTo;

/** One thing that happened to this account — see the migration. */
class Notification extends Model
{
    use HasFactory;

    protected $fillable = ['user_id', 'type', 'actor_id', 'subject_type', 'subject_id', 'data', 'dedupe_key'];

    protected function casts(): array
    {
        return ['data' => 'array', 'read_at' => 'datetime'];
    }

    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_id');
    }

    public function subject(): MorphTo
    {
        return $this->morphTo();
    }

    public function scopeUnread(Builder $query): Builder
    {
        return $query->whereNull('read_at');
    }

    public function toArray(): array
    {
        return [
            'id' => $this->id,
            'type' => $this->type,
            // The actor's name is copied into `data` at write time as well
            // (see Notifier) — this relation is the live version, and the
            // copy is what still renders after the account is gone.
            'actor' => $this->relationLoaded('actor') && $this->actor
                ? ['name' => $this->actor->name, 'username' => $this->actor->username]
                : null,
            'subject_type' => $this->subject_type === null ? null : class_basename($this->subject_type),
            'subject_id' => $this->subject_id,
            'data' => $this->data ?? [],
            'read' => $this->read_at !== null,
            'at' => $this->created_at,
        ];
    }
}
