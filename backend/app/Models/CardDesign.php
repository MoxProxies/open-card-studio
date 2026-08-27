<?php

namespace App\Models;

use App\Models\Concerns\OwnedByUser;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class CardDesign extends Model
{
    use HasFactory, OwnedByUser;

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
}
