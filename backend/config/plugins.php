<?php

/**
 * The known-plugin registry GET /api/plugins serves. This is deliberately
 * the simplest thing that could work for v1: a hand-maintained list in a
 * config file, not a submission/moderation/marketplace workflow — a
 * community plugin gets added here (or to a future database-backed
 * registry with the same shape) once it's vetted, the same way a
 * package manager's "featured" list works. The frontend's PluginManager
 * doesn't have to know or care whether an entry came from this static
 * config or a real table later; only PluginController does.
 *
 * `package` is the npm package name a build installs to actually get the
 * plugin's code (see the root README's "Plugin system" section) — this
 * registry is a discovery/trust index, not a code host or CDN.
 */
return [
    'registry' => [
        [
            'id' => 'scryfall',
            'kind' => 'import-source',
            'name' => 'Scryfall Import',
            'description' => "Search Scryfall's public card database and import a card's text and art directly.",
            'package' => '@card-studio/plugin-scryfall-import',
            'homepage' => 'https://scryfall.com',
            'first_party' => true,
        ],
        [
            'id' => 'default',
            'kind' => 'asset-pack',
            'name' => 'Default Asset Pack',
            'description' => 'The built-in classic trading-card frame and rarity set.',
            'package' => '@card-studio/plugin-asset-pack-default',
            'first_party' => true,
        ],
    ],
];
