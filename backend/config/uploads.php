<?php

return [
    /*
     * What an account may send, and what happens to it.
     *
     * Every one of these is a knob rather than a constant because the
     * right value depends on the deployment: `max_bytes` in particular
     * has to fit inside PHP's own `upload_max_filesize` and
     * `post_max_size`, and a file over *those* never reaches Laravel at
     * all — it arrives as an empty upload with a confusing message. If
     * you raise this, raise the ini settings with it.
     */
    'max_bytes' => (int) env('UPLOAD_MAX_BYTES', 4 * 1024 * 1024),

    /*
     * The longest edge anything is kept at. A card printed at 300dpi is
     * roughly 750x1050px, so this is already generous for art meant to
     * fill one — and it's the single biggest thing keeping stored files
     * (and the pages that serve them) small.
     */
    'max_dimension' => (int) env('UPLOAD_MAX_DIMENSION', 2400),

    /*
     * The largest width or height a *source* file may declare before
     * it's decoded at all. `max_dimension` above only bounds what's kept
     * after resizing — GD has already allocated the full uncompressed
     * bitmap for the original by then. A tiny, highly-compressible file
     * can declare dimensions large enough to make that allocation itself
     * the attack, so this is checked against the file's header (which
     * `getimagesize()` reads without decoding pixel data) before
     * anything is decoded. Generous enough for a real camera's largest
     * output, far short of what a decompression bomb declares.
     */
    'max_source_dimension' => (int) env('UPLOAD_MAX_SOURCE_DIMENSION', 10000),

    /*
     * Total bytes one account may hold. Counted from what's stored after
     * re-encoding, not from what was sent.
     */
    'quota_bytes' => (int) env('UPLOAD_QUOTA_BYTES', 100 * 1024 * 1024),

    /*
     * What a browser may send us. Deliberately not SVG: an SVG is a
     * document, not a bitmap — it can carry script, and it is the one
     * image format where "just re-encode it" doesn't neutralise that.
     */
    'accepted_mime_types' => ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],

    /*
     * JPEG/WebP quality for the re-encode. 82 is the usual point where
     * artefacts stop being visible at a glance.
     */
    'quality' => (int) env('UPLOAD_QUALITY', 82),
];
