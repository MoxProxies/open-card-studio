<?php

namespace App\Support;

use Illuminate\Http\UploadedFile;
use RuntimeException;

/**
 * Turns a file a stranger sent us into bytes we're willing to store and
 * serve back.
 *
 * The load-bearing idea is that **nothing a user uploads is ever stored
 * or served verbatim**. Everything is decoded to a raw bitmap and
 * re-encoded from scratch, which buys three things a `mimes:` validation
 * rule can't:
 *
 *  - **Metadata is gone.** Phone photos carry EXIF, and EXIF carries GPS
 *    coordinates. Publishing a card would otherwise publish where its
 *    art was taken.
 *  - **Polyglots stop working.** A file can be a valid JPEG *and* a valid
 *    PHP script or HTML document at the same time; that's how "image
 *    upload" becomes "arbitrary code" on a misconfigured server. A
 *    re-encoded bitmap contains only pixels.
 *  - **The declared type has to be the real one.** GD either decodes it
 *    as the format we think it is, or we reject it.
 *
 * SVG is deliberately absent from the accepted types (config/uploads.php)
 * — it's a document that can carry script, and it's the one image format
 * where re-encoding isn't a defence because there's no bitmap to reduce
 * it to.
 */
class ImageIngest
{
    /** @return array{binary: string, mime: string, width: int, height: int} */
    public static function process(UploadedFile $file): array
    {
        $source = @imagecreatefromstring((string) file_get_contents($file->getRealPath()));

        if ($source === false) {
            // Reached when the bytes aren't a format GD can decode at all,
            // whatever the filename or the browser's Content-Type claimed.
            throw new RuntimeException('That file could not be read as an image.');
        }

        try {
            $resized = self::downscale($source);

            try {
                return self::encode($resized, $file->getMimeType());
            } finally {
                if ($resized !== $source) {
                    imagedestroy($resized);
                }
            }
        } finally {
            imagedestroy($source);
        }
    }

    /**
     * Caps the longest edge. Done before encoding so the quality setting
     * applies to the image we're actually keeping.
     *
     * @param  \GdImage  $source
     * @return \GdImage
     */
    private static function downscale($source)
    {
        $max = (int) config('uploads.max_dimension');
        $width = imagesx($source);
        $height = imagesy($source);
        $longest = max($width, $height);

        if ($longest <= $max) {
            return $source;
        }

        $scale = $max / $longest;
        $target = imagescale($source, (int) round($width * $scale), (int) round($height * $scale));

        if ($target === false) {
            throw new RuntimeException('That image could not be resized.');
        }

        return $target;
    }

    /**
     * Re-encodes in the format it arrived in, rather than converting
     * everything to one output format.
     *
     * WebP would be smaller, but the art in a design also travels through
     * PDF export and the render service, and quietly changing the format
     * of every image is not a change to make blind. GIF is the exception:
     * it becomes a PNG, because what a card wants from a GIF is its first
     * frame, and keeping the animation would mean keeping a format the
     * rest of the pipeline treats as a still anyway.
     *
     * @param  \GdImage  $image
     * @return array{binary: string, mime: string, width: int, height: int}
     */
    private static function encode($image, ?string $sourceMime): array
    {
        $quality = (int) config('uploads.quality');

        // Alpha has to be preserved explicitly or PNG round-trips come
        // back with black where the transparency was.
        imagealphablending($image, false);
        imagesavealpha($image, true);

        $mime = match ($sourceMime) {
            'image/jpeg' => 'image/jpeg',
            'image/webp' => 'image/webp',
            default => 'image/png',
        };

        ob_start();

        $ok = match ($mime) {
            'image/jpeg' => imagejpeg($image, null, $quality),
            'image/webp' => imagewebp($image, null, $quality),
            default => imagepng($image, null, 6),
        };

        $binary = (string) ob_get_clean();

        if (! $ok || $binary === '') {
            throw new RuntimeException('That image could not be processed.');
        }

        return [
            'binary' => $binary,
            'mime' => $mime,
            'width' => imagesx($image),
            'height' => imagesy($image),
        ];
    }
}
