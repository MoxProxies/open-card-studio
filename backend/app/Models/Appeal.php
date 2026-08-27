<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** One request to have a suspension reconsidered — see the migration. */
class Appeal extends Model
{
    use HasFactory;

    public const OPEN = 'open';

    // `state`, `response`, `resolved_by` and `resolved_at` are deliberately
    // absent: they're the moderator's half of the row, and the appellant
    // posts the other half. Same rule as Report::$state and User::$is_staff
    // — a staff-only column is never fillable, and the staff endpoint
    // assigns it explicitly.
    protected $fillable = ['user_id', 'message'];

    protected function casts(): array
    {
        return ['resolved_at' => 'datetime'];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function resolver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'resolved_by');
    }

    /** What the appellant sees about their own appeal. */
    public function toArray(): array
    {
        return [
            'id' => $this->id,
            'message' => $this->message,
            'state' => $this->state,
            'response' => $this->response,
            'submitted_at' => $this->created_at,
            'resolved_at' => $this->resolved_at,
        ];
    }
}
