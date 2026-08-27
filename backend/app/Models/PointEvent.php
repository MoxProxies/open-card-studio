<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One row of the append-only points ledger. Nothing ever updates or
 * deletes these — a correction is a new row with a negative amount. See
 * App\Support\PointsLedger for the only code that writes them.
 */
class PointEvent extends Model
{
    use HasFactory;

    protected $fillable = ['user_id', 'amount', 'reason', 'source_type', 'source_id', 'dedupe_key'];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
