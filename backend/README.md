# open-card-studio backend

The API backend for [open-card-studio](../README.md) — see the root
README's [Backend (API)](../README.md#backend-api) section for what this
serves, what it doesn't do yet, and how to run it. This file just covers
Laravel-specific day-to-day commands.

## Common commands

```sh
composer install
cp .env.example .env
php artisan key:generate
touch database/database.sqlite
php artisan migrate

php artisan serve          # dev server
php artisan migrate:fresh  # drop + re-run all migrations
php artisan route:list     # see every registered route
./vendor/bin/pint          # code style
./vendor/bin/phpunit       # tests (none written yet — see root README)
```

## Layout

- `app/Models/` — `User`, `CardDesign`, `Template`, `Collection`, `Report`;
  `Concerns/` holds what they share (`OwnedByUser`, `Publishable`).
- `app/Http/Controllers/Api/` — `AuthController`, `CardDesignController`,
  `TemplateController`, `CollectionController`, `ProfileController`,
  `ReportController`,
  `PluginController`. The owned-content controllers share
  `OwnedContentController` (publish/delete).
- `routes/api.php` — the entire route list; there is no `web.php`, see
  `bootstrap/app.php`'s doc comment for why.
- `config/plugins.php` — the plugin discovery registry `GET /api/plugins`
  serves.
- `database/migrations/` — `users`/`sessions`/`cache`/`jobs` are
  Laravel's own framework tables (needed since `.env.example` defaults
  cache/queue/session to the `database` driver); `personal_access_tokens`
  is Sanctum's; `card_designs`, `templates`, `collections`
  (+ its `card_design_collection` pivot) and `reports` are the
  app-specific tables. `templates` holds community-authored card layouts — a scene
  Design blob plus owner/name/description/tags/visibility/usage count,
  see the root README's [Community
  templates](../README.md#community-templates).
