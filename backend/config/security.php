<?php

return [
    /*
     * Rate limits that need to differ between a real deployment and a
     * test run, and so can't be hardcoded in AppServiceProvider.
     *
     * Registration is per-IP: mass signup from one host is the abuse this
     * stops, and keying it any finer (by email, say) would be free to
     * evade. The consequence is that everyone behind one NAT — an office,
     * a mobile carrier, or an end-to-end run where every suite is
     * 127.0.0.1 — draws on the same bucket, which is why the number is a
     * knob rather than a constant. The e2e runner raises it; nothing else
     * should need to.
     */
    'register_per_minute' => (int) env('REGISTER_PER_MINUTE', 30),
];
