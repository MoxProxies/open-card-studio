<?php

/**
 * Knowledge-base categories. A config shortlist rather than a table or a
 * database enum — the same call as report reasons and template tags:
 * adding "Sleeves" later shouldn't need a migration, and the set is small
 * enough that a curated list beats free text for browsing.
 */
return [
    'categories' => [
        'printing' => 'Printing',
        'cutting' => 'Cutting & finishing',
        'materials' => 'Card stock & materials',
        'design' => 'Design tips',
        'showcase' => 'Showcase',
        'general' => 'General',
    ],
];
