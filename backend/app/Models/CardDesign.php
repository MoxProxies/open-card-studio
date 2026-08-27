<?php

namespace App\Models;

use App\Models\Concerns\OwnedByUser;
use App\Models\Concerns\Publishable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class CardDesign extends Model
{
    use HasFactory, OwnedByUser, Publishable;

    protected $fillable = [
        'id',
        'user_id',
        'name',
        'design',
        'visibility',
    ];

    protected function casts(): array
    {
        return [
            'design' => 'array',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** A listing row — never the design blob, which is fetched one at a time. */
    public function toSummary(): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'visibility' => $this->visibility,
            'updated_at' => $this->updated_at,
        ];
    }
}
