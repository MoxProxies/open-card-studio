<?php

namespace App\Support;

use App\Models\CardDesign;
use App\Models\Collection;
use App\Models\Post;
use App\Models\Template;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\In;

/**
 * The short type names the reaction/feature endpoints take, mapped to
 * models. One list so "what can be liked or featured" is defined once —
 * ReportController has its own (slightly different) list because what can
 * be *reported* also includes accounts, which can't be liked.
 */
class Reactable
{
    public const TYPES = [
        'design' => CardDesign::class,
        'template' => Template::class,
        'collection' => Collection::class,
        'post' => Post::class,
    ];

    public static function rule(): In
    {
        return Rule::in(array_keys(self::TYPES));
    }

    public static function find(string $type, string $id): ?Model
    {
        $model = self::TYPES[$type] ?? null;

        return $model ? $model::visibleToPublic()->with('user')->find($id) : null;
    }
}
