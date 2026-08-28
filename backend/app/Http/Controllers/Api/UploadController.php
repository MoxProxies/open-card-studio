<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Upload;
use App\Support\ImageIngest;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use RuntimeException;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Stored images: card art and avatars.
 *
 * The reason this exists is in the migration — art used to be a base64
 * data URL inside the design JSON, so a design with a photo in it was a
 * multi-megabyte row that every save rewrote and every gallery visitor
 * downloaded.
 *
 * Nothing sent here is stored as it arrived: everything is decoded and
 * re-encoded (see ImageIngest), which strips EXIF, neutralises polyglot
 * files, and makes the declared type prove itself.
 */
class UploadController extends Controller
{
    public function store(Request $request)
    {
        $data = $request->validate([
            'file' => [
                'required',
                'file',
                'max:'.(int) (config('uploads.max_bytes') / 1024),
                // Checked here *and* proven by ImageIngest actually
                // decoding it. This rule reads the browser's claim; the
                // decode is what makes the claim true.
                'mimetypes:'.implode(',', config('uploads.accepted_mime_types')),
            ],
            'kind' => ['sometimes', Rule::in([Upload::ART, Upload::AVATAR])],
        ]);

        $user = $request->user();

        try {
            $image = ImageIngest::process($request->file('file'));
        } catch (RuntimeException $e) {
            throw ValidationException::withMessages(['file' => [$e->getMessage()]]);
        }

        $checksum = hash('sha256', $image['binary']);

        // The same file twice is the same upload. Re-adding art you
        // already have shouldn't cost quota, and two identical rows would
        // just be two things to moderate separately.
        if ($existing = $user->uploads()->where('checksum', $checksum)->first()) {
            return response()->json($existing, 200);
        }

        $used = (int) $user->uploads()->sum('bytes');
        $quota = (int) config('uploads.quota_bytes');

        if ($used + strlen($image['binary']) > $quota) {
            throw ValidationException::withMessages([
                'file' => ['That would put you over your '.round($quota / 1024 / 1024).' MB of storage. Delete something first.'],
            ]);
        }

        $upload = new Upload;
        $upload->id = (string) Str::uuid();
        $upload->user_id = $user->id;
        $upload->kind = $data['kind'] ?? Upload::ART;
        $upload->mime = $image['mime'];
        $upload->bytes = strlen($image['binary']);
        $upload->width = $image['width'];
        $upload->height = $image['height'];
        $upload->checksum = $checksum;

        // The file first: a row pointing at bytes that aren't there is a
        // broken image, while bytes with no row are invisible and get
        // cleaned up by the next identical upload.
        Storage::disk('local')->put($upload->path(), $image['binary']);
        $upload->save();

        return response()->json($upload, 201);
    }

    /** What this account is holding, and how much room is left. */
    public function index(Request $request)
    {
        $uploads = $request->user()->uploads()->latest()->get();

        return response()->json([
            'uploads' => $uploads,
            'used_bytes' => (int) $uploads->sum('bytes'),
            'quota_bytes' => (int) config('uploads.quota_bytes'),
        ]);
    }

    /**
     * Serves the bytes. Public on purpose: art inside a published design
     * has to load for anyone looking at it, and gating this behind auth
     * would mean a signed-out visitor sees a card with holes in it.
     *
     * The UUID is the access control — an upload nobody has the URL for
     * is unreachable, the same model unlisted templates use.
     */
    public function show(string $id): StreamedResponse
    {
        $upload = Upload::servable()->findOrFail($id);
        $disk = Storage::disk('local');

        abort_unless($disk->exists($upload->path()), 404);

        return $disk->response($upload->path(), null, [
            'Content-Type' => $upload->mime,
            // Immutable: the bytes behind an id never change (a different
            // image is a different upload), so a browser that has it once
            // never needs to ask again.
            'Cache-Control' => 'public, max-age=31536000, immutable',
            'ETag' => '"'.$upload->checksum.'"',
        ]);
    }

    public function destroy(Request $request, string $id)
    {
        $upload = $request->user()->uploads()->findOrFail($id);
        $upload->delete();

        return response()->json(['id' => $id, 'deleted' => true]);
    }
}
