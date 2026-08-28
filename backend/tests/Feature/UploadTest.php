<?php

namespace Tests\Feature;

use App\Models\Upload;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
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

    public function test_one_account_cannot_read_anothers_upload_listing(): void
    {
        $owner = $this->account();
        $this->actingAs($owner)->post('/api/uploads', ['file' => $this->png()])->assertCreated();

        $body = $this->actingAs($this->account('other@example.com'))->getJson('/api/uploads')->assertOk()->json();

        $this->assertSame([], $body['uploads']);
    }
}
