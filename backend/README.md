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

- `app/Models/` — `User`, `CardDesign`.
- `app/Http/Controllers/Api/` — `AuthController`, `CardDesignController`,
  `PluginController`.
- `routes/api.php` — the entire route list; there is no `web.php`, see
  `bootstrap/app.php`'s doc comment for why.
- `config/plugins.php` — the plugin discovery registry `GET /api/plugins`
  serves.
- `database/migrations/` — `users`/`sessions`/`cache`/`jobs` are
  Laravel's own framework tables (needed since `.env.example` defaults
  cache/queue/session to the `database` driver); `personal_access_tokens`
  is Sanctum's; `card_designs` is the one app-specific table.
