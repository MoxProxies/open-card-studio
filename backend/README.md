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
./vendor/bin/phpunit       # PHP tests (tests/Feature)

php artisan auth:reset-link me@example.com   # a reset link, no mail sent
```

## Layout

- `app/Models/` — `User`, `CardDesign`, `Template`, `Collection`, `Report`,
  `Reaction`, `PointEvent`, `Badge`, `Post`, `PostRevision`, `Comment`,
  `ModerationAction`, `Appeal`;
  `Concerns/` holds what they share (`OwnedByUser`, `Publishable`).
- `app/Http/Controllers/Api/` — `AuthController`, `CardDesignController`,
  `TemplateController`, `CollectionController`, `ProfileController`,
  `ReportController`, `SocialAuthController`, `EmailController`,
  `AppealController`, `PluginController`. The owned-content controllers share
  `OwnedContentController` (publish/delete).
- `routes/api.php` — the entire route list; there is no `web.php`, see
  `bootstrap/app.php`'s doc comment for why.
- `app/Support/` — `PointsLedger`, `Levels`, `BadgeRules`, `Reactable`.
- `config/gamification.php` — every points/levels/badges number.
- `config/security.php` — rate limits that differ between a deployment
  and a test run; `app/Support/DeviceName.php` labels a session's device.
- `config/knowledge_base.php` — knowledge-base categories.
- `app/Http/Middleware/` — `EnsureStaff` (404s for non-staff),
  `BlockSuspendedUsers`.
- `app/Support/SocialProviders.php` + `config/services.php` — which OAuth
  providers this deployment offers.
- `app/Notifications/` + `config/mail.php` — the two transactional emails
  (verify address, reset password) over Brevo's SMTP relay; see the root
  README's [Transactional email](../README.md#transactional-email-brevo).
- `tests/Feature/` — PHP tests for logic a live run can't be asked to
  prove (social account linking, mail actually being sent).
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
