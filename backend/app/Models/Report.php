<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphTo;

/**
 * A user-filed report against any piece of content — one polymorphic
 * table for designs, templates and accounts today, collections and
 * knowledge-base posts later. See docs/PRODUCT_VISION.md: the point of
 * building this before anything is genuinely public is that retrofitting
 * a report path afterwards is much harder than having the rows from day
 * one. The queue that reads these is Phase 4/6 work.
 */
class Report extends Model
{
    use HasFactory;

    protected $fillable = [
        'reportable_type',
        'reportable_id',
        'reporter_id',
        'reason',
        'details',
    ];

    /** Staff-only; a report always arrives OPEN. */
    public const OPEN = 'open';

    public function reportable(): MorphTo
    {
        return $this->morphTo();
    }

    public function reporter(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reporter_id');
    }
}
