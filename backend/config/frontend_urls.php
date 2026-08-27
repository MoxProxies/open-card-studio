<?php

/**
 * Every origin the frontend is served from. Two things read this and both
 * are security boundaries:
 *
 *  - SocialAuthController allowlists the URL it hands a fresh token back
 *    to. An unchecked redirect target there leaks a valid session.
 *  - The password-reset and verification emails build their links from
 *    the first entry (see config('frontend_urls')[0] usage).
 *
 * Comma-separated in FRONTEND_URLS; the first is the canonical one.
 */
return array_values(array_filter(array_map('trim', explode(',', (string) env('FRONTEND_URLS', 'http://localhost:4173')))));
