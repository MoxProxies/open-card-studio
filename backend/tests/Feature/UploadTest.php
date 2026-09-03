<?php

namespace Tests\Feature;

use App\Models\Upload;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * What happens to stored images on disk — which the end-to-end suites
 * can't see, since they only ever talk to the app over HTTP.
 */
class UploadTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
    }

    private function account(string $email = 'artist@example.com'): User
    {
        return User::create([
            'name' => 'Art Ist',
            'email' => $email,
            'username' => str($email)->before('@')->toString(),
            'password' => 'password123',
        ]);
    }

    private function png(int $width = 400, int $height = 300): UploadedFile
    {
        $image = imagecreatetruecolor($width, $height);
        imagefill($image, 0, 0, imagecolorallocate($image, random_int(0, 255), 90, 200));
        ob_start();
        imagepng($image);
        $binary = (string) ob_get_clean();
        imagedestroy($image);

        $path = tempnam(sys_get_temp_dir(), 'png').'.png';
        file_put_contents($path, $binary);

        return new UploadedFile($path, 'art.png', 'image/png', null, true);
    }

    /**
     * A PNG that is only its signature and an IHDR chunk claiming
     * extreme dimensions — no IDAT pixel data at all. `getimagesize()`
     * (and libmagic's MIME sniffing) only ever look at these first few
     * bytes, so this is enough to pose as a decompression bomb without
     * actually costing anything to build.
     */
    private function bombPng(int $width, int $height): UploadedFile
    {
        $ihdrData = pack('NNCCCCC', $width, $height, 8, 6, 0, 0, 0);
        $ihdr = pack('N', strlen($ihdrData)).'IHDR'.$ihdrData.pack('N', crc32('IHDR'.$ihdrData));
        $binary = "\x89PNG\r\n\x1a\n".$ihdr;

        $path = tempnam(sys_get_temp_dir(), 'bomb').'.png';
        file_put_contents($path, $binary);

        return new UploadedFile($path, 'bomb.png', 'image/png', null, true);
    }

    public function test_the_bytes_land_on_disk_and_the_row_points_at_them(): void
    {
        $user = $this->account();

        $body = $this->actingAs($user)->post('/api/uploads', ['file' => $this->png()])->assertCreated()->json();

        $upload = Upload::findOrFail($body['id']);
        Storage::disk('local')->assertExists($upload->path());
        $this->assertSame(Storage::disk('local')->size($upload->path()), $upload->bytes);
    }

    public function test_deleting_an_upload_takes_the_file_with_it(): void
    {
        $user = $this->account();
        $id = $this->actingAs($user)->post('/api/uploads', ['file' => $this->png()])->json('id');
        $path = Upload::findOrFail($id)->path();

        $this->actingAs($user)->deleteJson("/api/uploads/{$id}")->assertOk();

        // An orphaned file is storage nobody can reach and nobody bills
        // for — it just accumulates.
        Storage::disk('local')->assertMissing($path);
    }

    public function test_closing_an_account_takes_its_files_with_it(): void
    {
        $user = $this->account();
        $id = $this->actingAs($user)->post('/api/uploads', ['file' => $this->png()])->json('id');
        $path = Upload::findOrFail($id)->path();

        $this->actingAs($user)->deleteJson('/api/account', ['password' => 'password123'])->assertOk();

        $this->assertDatabaseCount('uploads', 0);
        // The foreign key cascade would delete the row and leave the
        // bytes on disk forever, which is why AccountController deletes
        // uploads through the model first.
        Storage::disk('local')->assertMissing($path);
    }

    public function test_a_removed_upload_stops_being_served(): void
    {
        $user = $this->account();
        $id = $this->actingAs($user)->post('/api/uploads', ['file' => $this->png()])->json('id');

        $this->get("/api/uploads/{$id}")->assertOk();

        $upload = Upload::findOrFail($id);
        $upload->moderation_state = 'removed';
        $upload->save();

        // Hidden from everyone, its owner included — the same rule every
        // other kind of content follows.
        $this->get("/api/uploads/{$id}")->assertNotFound();
        $this->actingAs($user)->get("/api/uploads/{$id}")->assertNotFound();
    }

    public function test_the_quota_is_enforced(): void
    {
        config(['uploads.quota_bytes' => 1]);

        $this->actingAs($this->account())
            ->postJson('/api/uploads', ['file' => $this->png()])
            ->assertStatus(422)
            ->assertJsonValidationErrors('file');

        $this->assertDatabaseCount('uploads', 0);
        $this->assertEmpty(Storage::disk('local')->allFiles('uploads'));
    }

    public function test_a_file_declaring_extreme_dimensions_is_rejected_before_decoding(): void
    {
        // 60000x60000 at 4 bytes/pixel is a ~14GB bitmap GD would have to
        // allocate to decode this — a request that should fail fast on
        // the header, not hang or exhaust memory trying to honour it.
        $this->actingAs($this->account())
            ->postJson('/api/uploads', ['file' => $this->bombPng(60000, 60000)])
            ->assertStatus(422)
            ->assertJsonValidationErrors('file');

        $this->assertDatabaseCount('uploads', 0);
    }

    public function test_a_save_failure_after_the_write_does_not_leave_an_orphaned_file(): void
    {
        $user = $this->account();

        // Simulates the write landing on disk but the row failing to
        // save afterward — the exact gap the fix cleans up.
        Upload::saving(fn () => throw new \RuntimeException('simulated database failure'));

        $this->actingAs($user)->postJson('/api/uploads', ['file' => $this->png()])->assertStatus(500);

        $this->assertDatabaseCount('uploads', 0);
        $this->assertEmpty(Storage::disk('local')->allFiles('uploads'));
    }

    /**
     * The race PointsLedger/Notifier/Reaction already guard against,
     * hitting the checksum de-dupe: the existence check in store() and
     * $upload->save() aren't atomic, so uploading the same file twice at
     * once (a double-submit) can send two saves in before either row
     * lands. Reproduced the same way those do — at the exact gap, via a
     * model event.
     */
    public function test_a_double_submit_of_the_same_file_that_loses_the_race_serves_the_winners_row_not_a_500(): void
    {
        $user = $this->account();
        $file = $this->png();

        $raced = false;
        $winnerId = null;

        // Fires inside this request's own $upload->save() call — after
        // the existence check already found no upload with this checksum,
        // but before this request's own row lands. Creating it here
        // reproduces exactly what a second, concurrent upload of the same
        // file would do. The checksum isn't known ahead of time (it's of
        // the *re-encoded* bytes ImageIngest produces, not the raw
        // upload), so this reads it off the very row it's about to race
        // rather than precomputing it.
        Upload::creating(function (Upload $upload) use (&$raced, &$winnerId, $user) {
            if ($raced) {
                return;
            }

            $raced = true;
            $winner = new Upload;
            $winner->id = (string) Str::uuid();
            $winner->user_id = $user->id;
            $winner->kind = Upload::ART;
            $winner->mime = $upload->mime;
            $winner->bytes = $upload->bytes;
            $winner->width = $upload->width;
            $winner->height = $upload->height;
            $winner->checksum = $upload->checksum;
            // A real concurrent request would have written its own bytes
            // to disk too — the losing request's own file is what gets
            // cleaned up below, not this one.
            Storage::disk('local')->put($winner->path(), 'winner bytes');
            $winner->save();
            $winnerId = $winner->id;
        });

        // Without the fix this 500s: $upload->save()'s own read-then-write
        // hits the unique (user_id, checksum) index directly, unguarded.
        $body = $this->actingAs($user)->postJson('/api/uploads', ['file' => $file])->assertOk()->json();

        $this->assertTrue($raced);
        $this->assertSame($winnerId, $body['id']);
        $this->assertDatabaseCount('uploads', 1);
        // The bytes this losing request wrote to disk are a duplicate of
        // what the winner already stored — discarded, not left orphaned,
        // so only the winner's file remains.
        $this->assertCount(1, Storage::disk('local')->allFiles('uploads'));
    }

    public function test_one_account_cannot_read_anothers_upload_listing(): void
    {
        $owner = $this->account();
        $this->actingAs($owner)->post('/api/uploads', ['file' => $this->png()])->assertCreated();

        $body = $this->actingAs($this->account('other@example.com'))->getJson('/api/uploads')->assertOk()->json();

        $this->assertSame([], $body['uploads']);
    }
}
