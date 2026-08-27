<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

/**
 * An awardable badge. `rule` names a check in App\Support\BadgeRules that
 * grants it automatically; a null `rule` means it can only be granted by
 * hand (a founder awarding "Pillar"). Both are first-class — see
 * docs/PRODUCT_VISION.md on not assuming every badge is automatable.
 */
class Badge extends Model
{
    use HasFactory;

    public $incrementing = false;

    protected $keyType = 'string';

    protected $fillable = ['id', 'name', 'description', 'icon', 'rule'];

    public function users(): BelongsToMany
    {
        return $this->belongsToMany(User::class)->withTimestamps();
    }

    public function toArray(): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'description' => $this->description,
            'icon' => $this->icon,
            // Whether it can be earned, or only handed out.
            'automatic' => $this->rule !== null,
        ];
    }
}
