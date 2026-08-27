<?php

namespace App\Models;

use App\Models\Concerns\OwnedByUser;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Storage;

/** One stored image — see the migration for why art no longer lives
 * inside the design JSON. */
class Upload extends Model
{
    use HasFactory, OwnedByUser;

    public const ART = 'art';

    public const AVATAR = 'avatar';

    // Nothing here is fillable: every column is either derived from the
    // processed image (mime, bytes, width, height, checksum) or a
    // staff-only state. The controller assigns them, same rule as
    // Report::$state and User::$is_staff.
    protected $fillable = [];

    /** Where the bytes live. Kept out of the database: the id and the
     * mime determine it, and a path column is one more thing that can
     * disagree with the disk. */
    public function path(): string
    {
        return 'uploads/'.$this->id.'.'.match ($this->mime) {
            'image/jpeg' => 'jpg',
            'image/webp' => 'webp',
            default => 'png',
        };
    }

    public function delete(): ?bool
    {
        // The row and the file go together — an orphaned file is storage
        // nobody can reach, and an orphaned row is a 404 with a database
        // entry behind it.
        Storage::disk('local')->delete($this->path());

        return parent::delete();
    }

    /** A removed image stops being served, to everyone including its
     * owner — same rule as every other piece of user content. */
    public function scopeServable(Builder $query): Builder
    {
        return $query->where('moderation_state', '!=', 'removed');
    }

    public function toArray(): array
    {
        return [
            'id' => $this->id,
            'kind' => $this->kind,
            'mime' => $this->mime,
            'bytes' => $this->bytes,
            'width' => $this->width,
            'height' => $this->height,
            'url' => url('/api/uploads/'.$this->id),
            'created_at' => $this->created_at,
        ];
    }
}
