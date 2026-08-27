<?php

/**
 * Every tunable number in the points/levels/badges system, in one place.
 *
 * docs/PRODUCT_VISION.md lists "the actual points-per-action numbers" as
 * an open decision for a human, not a session — so these are deliberately
 * round placeholder values chosen to be explainable, not balanced. Change
 * them here; nothing reads a hardcoded number anywhere else, and the
 * ledger is append-only, so editing a value changes what *future* events
 * are worth without rewriting history.
 */
return [
    /**
     * Points awarded, keyed by reason. The reason string is stored on
     * every ledger row, so "why did I get these points" is answerable
     * from the data alone.
     *
     * Awarded to the *owner* of the content, not the person acting —
     * these are engagement rewards. A reaction to your own content is
     * worth nothing (see PointsLedger::awardForReaction).
     */
    'points' => [
        'reaction_received' => 1,
        'template_published' => 10,
        'template_used' => 2,
        'collection_published' => 5,
        'design_published' => 2,
        'post_published' => 15,
    ],

    /**
     * Cumulative points needed for each level, lowest first. Level 1 is
     * where everyone starts. A table rather than a formula on purpose:
     * "you need 150 points for level 4" is something you can tell a user,
     * and someone can retune the curve without touching code.
     */
    'levels' => [
        ['level' => 1, 'points' => 0, 'name' => 'Newcomer'],
        ['level' => 2, 'points' => 25, 'name' => 'Maker'],
        ['level' => 3, 'points' => 100, 'name' => 'Regular'],
        ['level' => 4, 'points' => 250, 'name' => 'Contributor'],
        ['level' => 5, 'points' => 600, 'name' => 'Veteran'],
        ['level' => 6, 'points' => 1500, 'name' => 'Luminary'],
    ],

    /** Featuring your own work on your profile unlocks at this level... */
    'feature_min_level' => 2,

    /** ...and this many things can be featured at once. */
    'feature_limit' => 6,
];
