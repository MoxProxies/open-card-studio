# open-card-studio

A standalone, cross-platform card-design tool — mix and match frames,
custom text, and free-floating elements to build custom trading-card
designs. Think [Card Conjurer](https://github.com/Investigamer/cardconjurer)
crossed with Canva.

This is a **fork of [card-studio](https://github.com/moxproxies/card-studio)**,
restructured into a standalone product: a React frontend + a new Laravel
API backend (`backend/`, token-auth via Sanctum — the same auth a future
iOS/Android client would use), decoupled entirely from MoxProxies. The two
things that changed on top of everything card-studio already did:

1. **A backend now exists, and the editor calls it.** The original had
   none — pure `localStorage`. `backend/` is a from-scratch Laravel API
   (auth, card-design CRUD, a plugin registry endpoint), and `apps/editor`
   authenticates against it and swaps its save/load storage over once a
   shopper signs in. See [Backend (API)](#backend-api) below for exactly
   how the wiring works.
2. **Hardcoded Scryfall integration became an optional plugin.** See
   [Plugin system](#plugin-system) — the goal is that nothing IP-specific
   (a particular card game's database, a particular visual style) is
   baked into the core editor; it's all swappable, community-extensible
   packages instead.

Everything else below (layers, frames, text fitting, undo/redo, the embed
build, etc.) is inherited from the original fork point largely unchanged
— this README documents the whole app, not just what's new.

**This README documents how the code works today.** For what this app is
being built *toward* as a product (accounts, collections, a community
knowledge base, gamification, a generic template engine) and the order
to build it in, see [`docs/PRODUCT_VISION.md`](docs/PRODUCT_VISION.md) —
read that before starting a new product phase in a fresh session.

## Status

Early scaffold, but no longer a `localStorage`-only one. The pieces below
are wired together and verified working end-to-end (typecheck, build,
real render smoke tests, browser-driven UX checks including the embedded
shadow-DOM path, and — for the backend and its wiring into the editor —
real curl-level API tests plus a full Playwright register/sign-in/save/
reload run against a live server). Auth and account-scoped persistence
exist now (see [Backend (API)](#backend-api) and
[Save/load](#saveload)); everything past that — collections, a knowledge
base, gamification — is still ahead, see
[`docs/PRODUCT_VISION.md`](docs/PRODUCT_VISION.md) and [Not built
yet](#not-built-yet).

## Plugin system

The core editor (`apps/editor`) ships with **zero knowledge of any
specific card game, data source, or visual theme baked in.** Two kinds
of plugin fill that gap, both defined by `@card-studio/plugin-sdk`
(`packages/plugin-sdk`):

- **`ImportSourcePlugin`** — lets a shopper pull card data in from
  somewhere external instead of typing every field by hand. Registering
  one adds an "Import" button to the toolbar; registering none means no
  button at all, not a broken one. `packages/plugin-scryfall-import` is
  the reference implementation, wrapping Scryfall's public API.
- **`AssetPackPlugin`** — a themeable bundle of frames and rarity
  symbols. `packages/plugin-asset-pack-default` wraps this app's
  existing bundled frame/rarity catalogs the same way. **Caveat:** only
  the *registration* path is real right now — the render pipeline
  (`LayerNode.tsx`, `renderDesign.ts` in `services/render`,
  `rulesFlavorFit.ts`) doesn't resolve assets *through* the active pack
  yet, it still reads the default pack's catalogs directly. Making every
  render path pack-aware is the next real step here; the interface
  exists now so a second pack can be built against a stable contract in
  the meantime.

`apps/editor/src/plugins.ts` is the one place plugins get registered,
into a single app-wide `PluginManager` instance:

```ts
import { PluginManager } from "@card-studio/plugin-sdk";
import { scryfallImportPlugin } from "@card-studio/plugin-scryfall-import";

export const pluginManager = new PluginManager();
pluginManager.registerImportSource(scryfallImportPlugin);
```

**Removing Scryfall** (or any import plugin) is exactly: delete its
`registerImportSource(...)` line here, remove the package from
`apps/editor/package.json`'s dependencies — the app still builds and
runs, the toolbar's Import button just stops rendering. No other file
changes. That's the concrete proof this isn't just an interface that
happens to have one hardcoded implementation underneath — the dependency
really is optional.

**Adding a community plugin** means writing a package that exports an
object satisfying `ImportSourcePlugin` or `AssetPackPlugin`
(`packages/plugin-sdk/src/types.ts` has the full shape and doc
comments), then registering it the same way. `GeneratedCardFields` (also
from `@card-studio/plugin-sdk`) is the entire contract an import
plugin's `SearchComponent` has to produce — it never touches layers,
Konva, or the design schema directly.

`backend/`'s `GET /api/plugins` (see [Backend (API)](#backend-api))
additionally serves a small discovery registry — the metadata for known
community plugins (npm package name, description, homepage), separate
from the actual plugin code, similar to how a package manager's
"featured" list works. It's currently a hand-maintained config file
(`backend/config/plugins.php`), not a submission/moderation workflow.

## Backend (API)

`backend/` is a fresh Laravel 11 API — separate from, and much smaller
than, moxproxies-website's Laravel app; this fork's editor was never
meant to depend on that codebase. **What it has:**

- Token auth via [Sanctum](https://laravel.com/docs/sanctum)
  (`POST /api/auth/register`, `/login`, `/logout`, `GET /api/auth/me`) —
  plain bearer tokens, no cookies/CSRF/SPA-session dance, so a future
  iOS/Android client authenticates identically to the web app. See
  `backend/bootstrap/app.php`'s doc comment for why there's no `web`
  route file at all.
- `card_designs` upsert-by-id (`GET /api/card-designs`,
  `GET/PUT/DELETE /api/card-designs/{id}`), scoped to
  `$request->user()` throughout — see `CardDesignController`. The `id`
  is client-generated (the frontend's own `crypto.randomUUID()`), so
  `PUT` is the only write verb: saving an existing design and creating a
  new one are the same call, `updateOrCreate`d against
  `{id, user_id}`. A `PUT` with an `id` that already belongs to another
  account 409s rather than colliding. The `design` column itself is
  stored and returned completely opaque (whatever JSON the frontend's
  `getDesign()` produces), so the frontend's schema can evolve without a
  backend migration.
- `templates` CRUD + publish + browse — community-authored card
  layouts, see [Community templates](#community-templates) below for the
  endpoint list and why a template is just a `Design` plus publishing
  metadata.
- `GET /api/plugins` — the plugin discovery registry described above.

**Wired up:** `apps/editor` calls all of this. `AccountButton` (top-right
of the toolbar, hidden behind the same `hideLocalDesignLibrary` flag as
the local "Designs" button — see [Save/load](#saveload)) handles
register/sign-in/sign-out and restores the session from a stored bearer
token on load; once signed in, `designStorage` (see
`apps/editor/src/designStorage.ts`) transparently swaps from
`localStorageDesignStorage` to `apiDesignStorage`, so the same
`DesignLibraryModal` save/load/delete UI now round-trips through this
API instead of `localStorage`. Point the editor at a different backend
with `VITE_API_BASE_URL` (defaults to `http://localhost:8000`).

**Running it:**

```sh
cd backend
composer install
cp .env.example .env
php artisan key:generate
touch database/database.sqlite   # default DB_CONNECTION=sqlite
php artisan migrate
php artisan serve                # http://localhost:8000
```

`CORS_ALLOWED_ORIGINS` in `.env` needs to include wherever the frontend
dev server runs (defaults to `apps/editor`'s configured
`http://localhost:4173` — see `apps/editor/vite.config.ts`).

The editor (`apps/editor`) currently supports:
- Add frame/text/image/shape layers; drag, resize, rotate via a Konva
  Transformer.
- Pan and zoom: `Ctrl/Cmd`+scroll to zoom on the cursor, plain scroll to
  pan, hold `Space`+drag or middle-mouse-drag to pan, plus a floating
  zoom control (bottom-right of the canvas) with in/out/percentage-reset/
  fit-to-view. A layer larger than the card, or a Transformer handle at
  the card's edge, is always reachable by zooming out or panning — see
  [Design decisions](#design-decisions) for why the Stage itself had to
  become a viewport rather than just adding scale to it.
- Imported images default to the full-bleed canvas, edge to edge, with
  `fit: "cover"` — never squished (a fixed box that stretched to fit,
  ignoring the source image's own shape, is what previously made every
  import come in squished) and never gapped at an edge either (an
  earlier version aspect-fit the layer's box to the image's own natural
  size instead, which more often than not left a visible gap on one
  axis — any real-world image's pixel aspect ratio essentially never
  matches the canvas's *exactly*). `fit: "cover"` crops whatever excess
  that mismatch produces instead, invisibly. See `addImage` in
  `Toolbar.tsx`.
- A frame library (currently 6 original, generic trading-card frame
  templates, organized into folders — see [Adding frames](#adding-frames)
  below) with a searchable/filterable browser: a folder dropdown and a
  text search apply concurrently. Opened from the toolbar's "Frame"
  button (adds a new frame layer sized to the full-bleed canvas, so the
  frame art reaches the true edge — see [Design
  decisions](#design-decisions)) or from a frame layer's "Change
  frame…" button in the properties panel (swaps its asset in place). Not
  an in-app upload button yet — see below.
- Multi-select: shift-click, or marquee (rubber-band) select on empty
  canvas.
- Alignment/snap guides while dragging a single layer (snaps to other
  layers' edges/centers and the card's edges/center).
- Undo/redo (`Ctrl/Cmd+Z` / `Ctrl/Cmd+Shift+Z`), duplicate (`Ctrl/Cmd+D`),
  delete (`Del`/`Backspace`), arrow-key nudge (`Shift` for a larger step).
- A properties panel: position/size/rotation/opacity, icon toggles for
  visible/locked, per-type fields (font/size/weight/color/align for text,
  frame picker + tint override for frames, fill/stroke for shapes, fit
  for images), and "align to card" for multi-select.
- Icons throughout (`lucide-react`) with a small shared stylesheet
  (`src/styles.css`) for consistent buttons/inputs — see the shadow-DOM
  note below for why it's `.cs-root` and not `:root`.
- The three-pane layout (canvas / layers / properties) is resizable —
  drag the handles between panels. The canvas area is always `flex: 1`
  (whatever's left over); only the two side panels have explicit,
  draggable widths (`App.tsx`, `ResizeHandle.tsx`).
- A "Text Fields" menu inserts the standard MTG text fields (title,
  mana cost, nickname, typeline, rules, flavor, P/T, artist/credit) at
  positions matching a classic MTG layout, individually or all at once,
  using whichever frame the design currently has to pick a config — see
  [MTG text fields](#mtg-text-fields) below.
- Text boxes shrink their font size to fit their box live in the editor
  (not just at export time), and support italic (uses the font's real
  italic file if the embedded family has one, otherwise a synthesized
  slant — same as bold).
- Embedded fonts: a folder-driven catalog (parallel to the frame
  library) with a dropdown in the properties panel, and a config
  constant for the default new text starts with — see
  [Adding fonts](#adding-fonts) below.
- A rarity dropdown places/swaps a rarity-symbol image layer at a
  config-adjustable position — see
  [Adding/changing rarity symbols](#addingchanging-rarity-symbols) below.
- Text can mix `{W}`/`{T}`/`{2}`/etc. inline with plain characters,
  wrapping and shrinking-to-fit right along with the surrounding words —
  see [Inline symbols in text](#inline-symbols-in-text) below.
- Text fields can grow (not just shrink) to fill their box, within a
  template-defined min/max range — see [MTG text fields](#mtg-text-fields)
  below.
- A "Scryfall" search fills in all of a real card's text fields, its
  artwork, and its rarity symbol in one click — see [Scryfall
  import](#scryfall-import) below.
- Text layers support a drop shadow (color/opacity/offset/blur, in the
  properties panel's "Shadow" section) — applies to the whole rendered
  layer, glyphs and inline `{token}` symbols alike, not just the
  characters. Off by default; `shadowColor` being unset is the on/off
  switch (see `schema.ts`).
- A bleed-preview toggle (the scissors icon next to the safe-area
  toggle) masks the bleed margin and rounds the corners to a 2.5mm
  ("R3") die-cut radius, previewing how the card looks once trimmed.
  View-only, like the safe-area toggle — doesn't change the design or
  the print export, which always renders the full rectangular bleed a
  printer needs to trim from.
- Layers are freely reorderable by dragging in the layer panel (a grip
  handle on the left of each row), not just one step at a time — and can
  be grouped under a named, collapsible header (multi-select → "Group" in
  the properties panel, or automatically when "Add all fields" runs) for
  bulk select/hide/lock/move. See [Layer groups](#layer-groups) below.
- A newly added layer (Frame/Text/Shape/Image, the rarity dropdown) is
  inserted directly above whichever layer is currently selected, instead
  of always at the very top of the stack — falls back to the top when
  nothing's selected. See `insertAboveSelection` in `designStore.ts`.
- Save/load: a "Designs" button in the toolbar saves the current design
  (name + layers + groups) and lists every save to reload later — see
  [Save/load](#saveload) below. Client-side only for now (no
  moxproxies-website account or database behind it yet — see [Not built
  yet](#not-built-yet)), but built against a small storage interface so
  swapping in a real backend later doesn't touch the UI.
- A "Signature" text field (`Text Fields` menu, and included in "Add all
  fields") — inline with Artist/Credit but right-aligned at the opposite,
  bottom-right corner instead of bottom-left.

## Layout

```
apps/editor/           React + TypeScript + Konva canvas editor
packages/scene-schema/ Shared Design/Layer JSON schema (zod), DPI-independent
services/render/       Fastify service: scene JSON -> print-quality PNG
```

pnpm workspaces. `packages/scene-schema` is the contract every other
piece depends on — build it first (`pnpm -r build` handles ordering
automatically; each app's `predev`/`prebuild` script does too).

```
pnpm install
pnpm build          # builds scene-schema, then editor (app + embed), then render
pnpm dev:editor      # http://localhost:4173 — standalone editor
pnpm dev:render      # http://localhost:3001 — render service
```

## Adding frames

1. Drop a PNG (transparent where art should show through — see below) into
   `frame-library/<category>/`, e.g. `frame-library/borderless/my-frame.png`.
   A new category name is just a new folder; it shows up in the picker's
   folder dropdown automatically, no code change.
2. Run `pnpm sync-frames` from the repo root. This copies the image into
   both `apps/editor/public/frames/` and `services/render/assets/frames/`,
   and regenerates both `frameCatalog.generated.json` files.
3. Commit everything sync touched (`frame-library/`, the two
   `public`/`assets` copies, the two generated JSON files).

The frame's `id` is `<category>/<filename-without-extension>`; its
display name and folder label are the filename/foldername with
hyphens/underscores turned into spaces and title-cased — rename the file
if you want a different display name, there's no separate metadata file
to edit.

**Draw new frame art with a transparent art window.** The area where a
card's art should show through (typically most of the card, between the
name bar and the type/text boxes) needs to be left unpainted — actual
alpha transparency, not white — so an Image layer placed underneath a
Frame layer shows through it. Painting that region any opaque color
(including white) hides the art entirely. See
`services/render/scripts/generate-placeholder-frames.mjs` for a worked
example of drawing a frame this way with `@napi-rs/canvas`; it's also
the script to rerun (writing into `frame-library/classic/`, then sync)
if you want to tweak the 6 built-in placeholder designs.

**New frame layers are sized to the full-bleed canvas, so frame art
needs to reach all four edges of its own image, not just the cut/trim
area.** Otherwise the bleed margin (the ~3mm strip that gets trimmed
away) shows the background color instead of a continuation of the
frame's border once printed and cut — see [Design
decisions](#design-decisions) for the full reasoning, and
`generate-placeholder-frames.mjs`'s `MARGIN`/`clearRect` for a worked
example of filling the whole canvas for bleed coverage while still
punching the art window back out to transparent afterward (a plain
"leave it unpainted" approach only works if nothing else fills over that
region first).

## Adding fonts

1. Drop a font file into `font-library/<Family Name>/<weight>.woff2` (or
   `.woff`/`.ttf`/`.otf`), e.g. `font-library/Playfair Display/700.woff2`.
   `<weight>` must be the CSS font-weight number for that file — 400 for
   regular, 700 for bold. A font used at both weights needs both files.
   Add `-italic` before the extension for a real italic design at that
   weight, e.g. `400-italic.woff2` — optional; a weight with no italic
   file still gets a working italic (the browser/print engine synthesizes
   a slant), this only matters for using the font's *actual* italic
   letterforms instead of a slanted regular.
2. Run `pnpm sync-fonts`. This copies the file into both
   `apps/editor/public/fonts/` and `services/render/assets/fonts/`,
   regenerates both `fontCatalog.generated.json` files, and regenerates
   `apps/editor/src/fonts.generated.css` (the `@font-face` rules the
   browser needs).
3. Commit everything sync touched.

The new family shows up in the properties panel's font dropdown (under
"Embedded") immediately — no other code change needed. To change what
*new* text layers default to, edit `DEFAULT_FONT_FAMILY` in
`apps/editor/src/config.ts`; it must name a family that's actually in the
catalog (or a system font), otherwise it silently falls back to whatever
the browser picks and print output won't match what the editor showed.

The repo ships with [Inter](https://github.com/rsms/inter) (regular,
bold, and both their italics) under the SIL Open Font License 1.1 — see
`font-library/Inter/LICENSE.txt` — sourced from the `@fontsource/inter`
npm package's static files (that package isn't a runtime dependency;
only its files were copied in).

**A redundant `normal` keyword in a canvas font string silently defeats
italic — but only server-side.** `services/render/src/renderDesign.ts`
originally built `ctx.font` as `` `${style} ${weight} ${size}px
${family}` `` unconditionally, so normal-weight italic text became the
string `"italic normal 16px Inter"`. Chromium's canvas parses that fine
(it normalizes away the redundant weight keyword and keeps the italic),
which is why the editor's live Konva rendering (`LayerNode.tsx`, which
already omitted default keywords) looked correct — but `@napi-rs/canvas`
(Skia) parses the same string differently and silently drops the italic,
rendering upright text instead. Confirmed by rendering both engines'
interpretation of that exact string side by side before fixing it.
Fixed by only ever including the non-default tokens (`italic`, `bold`)
in the font string, the same way `LayerNode.tsx` already built its
`fontStyle` — never emit a literal `normal`. Worth remembering for any
future canvas-font-string code: don't assume Skia's parser is as
forgiving as Chromium's.

**Print exports must use the same font the editor showed, or the
"preview" lied.** `services/render/src/fontAssets.ts` registers every
embedded font with `@napi-rs/canvas`'s `GlobalFonts.registerFromPath()`
once at server startup (called from `server.ts`), so `ctx.font = "bold
16px Inter"` in `renderDesign.ts` resolves to the actual embedded Inter
Bold file instead of silently substituting a system font server-side.
Confirmed this actually works before relying on it: `GlobalFonts`
registration accepts `.woff2` directly (no need to also ship `.ttf` for
the Node side), and registering two weight files under the same family
name correctly resolves per-weight when `ctx.font` asks for `bold` vs
normal.

**Canvas text doesn't wait for its own webfont to load.** The first text
layer on a freshly loaded page could render in the browser's fallback
font, then look fine forever after — because `@font-face` alone doesn't
make a `<canvas>` `fillText()` call wait for the font file to download;
that's a DOM-text behavior, not a canvas one, and react-konva only
redraws in response to React prop changes, which font loading isn't.
Fixed two ways: `loadEmbeddedFonts.ts`'s `preloadEmbeddedFonts()` (called
from both `main.tsx` and `embed.ts`) explicitly kicks off every embedded
family/weight via the CSS Font Loading API (`document.fonts.load(...)`)
as early as possible, and `CanvasStage.tsx` calls `stage.batchDraw()`
once `document.fonts.ready` resolves (plus on every `loadingdone` event,
in case something loads later) so an in-flight load still gets picked up
even if the preload race is lost. Reproduced the bug and confirmed the
fix by screenshotting a text layer added within ~150ms of page load,
before and after.

## Adding/changing rarity symbols

1. Drop (or edit) an SVG into `rarity-library/<id>.svg`, e.g.
   `rarity-library/mythic.svg`. Flat, not folders — there's one fixed set
   of rarity symbols, not an open-ended library like frames/fonts.
2. Run `pnpm sync-rarity`. This copies the file into both
   `apps/editor/public/rarity/` and `services/render/assets/rarity/`, and
   regenerates both `rarityCatalog.generated.json` files.
3. Commit everything sync touched. If you added a new id (not just
   edited an existing symbol), also add it to `RARITY_DISPLAY_ORDER` in
   `apps/editor/src/rarityConfig.ts` so the dropdown lists it in the
   right place instead of appending it alphabetically at the end.

The toolbar's rarity dropdown (`Toolbar.tsx`'s `setRarity`) finds-or-
creates a single image layer with a fixed, well-known id
(`RARITY_LAYER_ID` in `rarityConfig.ts`) rather than tracking "which
layer is the rarity symbol" as separate UI state — picking a rarity
either adds that layer (sized/positioned from `RARITY_SYMBOL_BOX`, also
in `rarityConfig.ts` — hand-tune it if a frame's type line sits
somewhere else) or swaps the existing one's asset, and picking the blank
"Rarity…" option removes it. The layer stores `assetId` (e.g.
`"mythic"`) as the source of truth, resolved against the rarity catalog
by both the editor and the render service the same way a frame's
`assetId` is — `src` is kept alongside it as a browser-usable URL cache
so the layer stays self-describing, but isn't what either renderer
actually reads for a library asset.

`@napi-rs/canvas`'s `loadImage()` handles `.svg` files directly (checked
before building on this — no PNG rasterization step needed, unlike frame
art which is authored as PNG from the start).

## Inline symbols in text

Any text layer with `overflow: "shrink"` (rules text, by default) can mix
plain characters with `{token}` symbols mid-paragraph — `"{T}: Add {R}."`
renders a tap symbol and a red mana pip inline, wrapping and shrinking
along with the surrounding words rather than needing a separate layer.
This matters for rules text specifically: mana costs sit in their own
fixed-position field (see [MTG text fields](#mtg-text-fields) below,
still just a plain string like `"{2}{W}{W}"`), but ability text routinely
needs a symbol in the middle of a wrapping sentence, which a standalone
image layer can't do.

**Why this doesn't use a two-glyph colored font**, the way tools like
[Proxyshop](https://github.com/Investigamer/Proxyshop) do it (confirmed
by reading its source: each mana symbol is *two* font characters — a
filled circle glyph plus a black pip glyph authored with a negative left
side bearing so it lands back on the circle — colored separately via
Photoshop's per-character rich-text API): that trick exists because
Photoshop's text API is rich-text-capable but a single `fillText()` call
isn't, so a font *has* to carry two differently-colored shapes to fake
per-character color. Canvas here is exactly that same single-color-per-
call primitive, so if a font hack is going to be necessary, it's
necessary for canvas too, plus it introduces a font-licensing/authoring
question we don't have otherwise. Instead, symbols are small SVGs (the
`SVG loads directly in @napi-rs/canvas` fact already established for
rarity symbols) drawn inline by the text layout itself — no per-character
font tricks needed, and no dependency on OpenType color-font (COLR/CPAL)
support, which is inconsistent enough between Chromium and Skia that
building on it would've been a gamble.

1. Drop an SVG into `symbol-library/<id>.svg` — flat, like
   `rarity-library/`. `{W}` looks up `w.svg`, `{W/U}` looks up `w-u.svg`
   (`/` becomes `-`; token matching lowercases and strips whitespace).
2. Run `pnpm sync-symbols`. Same copy-to-both-consumers-plus-catalog
   pattern as frames/rarity: `apps/editor/public/symbols/`,
   `services/render/assets/symbols/`, `symbolCatalog.generated.json` in
   both.
3. Commit everything sync touched.

The shipped set covers the mana/ability symbols that actually show up in
real oracle text — original, generic circle art (not a reproduction of
WotC's actual symbols, same reasoning as the frame art), not the exact
look of any specific card game:

- The five colors plus colorless: `w`, `u`, `b`, `r`, `g`, `c`
- Tap/untap: `t`, `q`
- All ten two-color hybrids (`w-u`, `u-b`, `b-r`, `r-g`, `g-w`, `w-b`,
  `u-r`, `b-g`, `r-w`, `g-u`) and the five 2-generic hybrids (`2-w`,
  `2-u`, `2-b`, `2-r`, `2-g`) — a circle split down the middle, one half
  per option, each half labeled like the mono-color symbols are
- The five Phyrexian variants (`w-p`, `u-p`, `b-p`, `r-p`, `g-p`) — same
  half-circle split, with the "pay life instead" half rendered as a
  black circle with a white `P` rather than a second color
- Snow (`s`) and energy (`e`)

Add more the same way, any time — nothing about the mechanism is
specific to this set.

**Generic mana numbers (`{0}`, `{1}`, `{2}`, ... any non-negative
integer) and variable costs (`{X}`, `{Y}`, `{Z}`) don't need a
symbol-library file at all** — `isGenericManaToken` (`symbolAssets.ts`)
recognizes pure-digit tokens and the three variable-cost letters, and a
shared routine draws a light-grey circle with the digit/letter centered
on top at draw time, in both the editor (`drawGenericManaSymbol`-
equivalent Konva nodes) and the render service (`drawGenericManaSymbol`
in `renderDesign.ts`) — covers arbitrary generic costs without one asset
per number. A real symbol-library asset always wins over this fallback
when both could apply (checked first) — relevant for something like
`{2/W}`, which is a real two-half asset (`2-w.svg`), not the generic
circle a bare `{2}` gets.

**How it's implemented, for anyone touching this code:**
`shrinkTextToFit` (`packages/scene-schema/src/textFit.ts`) — the same
shared word-wrap/shrink engine both the editor and render service already
called — now tokenizes each space-separated word into a run list (plain
text and/or symbols) via an injected `resolveSymbol(token) => boolean`
predicate, so a `{token}` the caller's asset catalog doesn't recognize
falls back to its literal `"{token}"` text instead of vanishing. A
symbol run gets a fixed `symbolWidth(fontSizePx)` (1em square, always —
see "Sizing and fonting symbols" below for the one thing about a
symbol's *drawn* appearance a field can configure, which deliberately
never touches this width) for wrapping purposes, so it wraps as an
atomic unit — `"{T}:"` (symbol
directly followed by punctuation, as MTG text commonly writes it) stays
together on one line as a single "word." The function's return type
changed from `lines: string[]` to `lines: LineLayout[]` (each line is a
list of positioned runs with their own x offset and width) since a line
is no longer just one string — both callers draw per-run now instead of
calling `fillText`/`<Text>` once per line: `renderDesign.ts`'s `drawText`
is `async` as of this change (symbol images load via `loadImage()` after
the final font size is known, not before — the shrink loop only needs
each symbol's *width*, a constant, not its pixels), and `LayerNode.tsx`
renders a `<Group>` of individually positioned `<Text>`/`<KonvaImage>`/
`<Circle>` nodes per line instead of one `<Text>` node, loading whatever
distinct symbol images the current content references via a new
`useHtmlImages` hook (`useHtmlImage`'s single-src version, generalized to
a dynamic list, since the set of symbols in play changes with content).

Every overflow mode resolves `{token}`s the same way, in both the editor
and the render service — `"clip"` and `"visible"` route through the same
run-based `<Group>` of `<Text>`/`<KonvaImage>`/`<Circle>` nodes as
`"shrink"` in `LayerNode.tsx`, they just skip the shrink search
(`shrink: false`, fixed at `fontSizePt`) and, for `"visible"`, wrap at
the box width the same as `"shrink"` does. `"clip"` keeps its
pre-existing single-line-per-`\n` behavior (no auto word-wrap) by
passing an unbounded `maxWidthPx` into `shrinkTextToFit` — only an
explicit newline in the content starts a new line. None of the three
modes actually clips vertically past the box today (that's a separate,
still-open gap in `"clip"`, unrelated to symbols).

### Sizing and fonting symbols

A `{token}` symbol always occupies exactly 1em of layout space
(`symbolWidth` in `textFit.ts` is a flat `(px) => px`, full stop) — that
part isn't configurable, deliberately: it's what keeps a mana-cost
field's own width, and where its text wraps, from shifting just because
a template tuned how a symbol *looks* inside that fixed space. What a
field's `TextFieldTemplate` (`textTemplates.ts`) *can* configure is
purely cosmetic, within that unchanging footprint:

- **`manaDigitScale`** (`TextLayer.manaDigitScale`, `schema.ts`) — scales
  the digit/letter drawn inside a **generic-mana-cost circle** (`{0}`,
  `{1}`, `{2}`, ..., `{X}`/`{Y}`/`{Z}`) relative to the circle's own
  fixed size (e.g. `1.15` = a 15% bigger digit, i.e. less visible
  padding inside the same bubble). The circle itself never changes size.
  This is *only* about that drawn circle+digit combo
  (`drawGenericManaSymbol` in `renderDesign.ts`, the equivalent Konva
  nodes in `LayerNode.tsx`) — every real symbol-library icon (colored
  mana, `{T}`, hybrids, Phyrexian, ...) is unaffected, on purpose: those
  are flat pre-rendered SVGs with the letter baked directly into the
  artwork (see `symbol-library/*.svg` — the circle already fills ~94% of
  its own canvas), so there's no separable glyph-vs-padding left to
  scale independently without literally growing the visible bubble,
  which is exactly what this field exists to avoid.
- **`fontFamily`** (already existed for the glyphs themselves) also
  reaches that same generic-mana digit — real text, unlike the circle
  and every symbol-library icon (images, so no font applies to them at
  all). Previously hardcoded to `sans-serif` regardless of the field's
  own configured font; both `drawGenericManaSymbol` and its
  `LayerNode.tsx` equivalent now take the layer's `fontFamily` instead.

Neither is set on any shipped template today (both default to the
existing look: digit at 62% of the circle's diameter, `sans-serif`) —
set them on `manaCost`'s entry in `text-template-library/_base.json` (or
a specific frame category's override) to opt in, then
`pnpm sync-text-templates`.

**The generic-mana digit is optically centered, not metrics-centered.**
`textBaseline: "middle"` (Canvas2D) / `verticalAlign: "middle"`
(Konva.Text) both center using the font's *declared* ascent + descent —
space reserved below the baseline for descenders (`g`, `y`, `p`, ...)
that no digit has, so a plain "centered" digit reads visibly high in
its circle regardless of which font is set. Both `drawGenericManaSymbol`
(`renderDesign.ts`) and `LayerNode.tsx`'s equivalent instead measure the
glyph's actual rendered ink via `measureText()`'s
`actualBoundingBoxAscent`/`Descent`/`Left`/`Right` (real per-glyph
extents, not font metrics) and manually position it so that ink — not
the font's em-box — sits centered in the circle. `LayerNode.tsx` draws
this via a Konva `Shape`'s `sceneFunc` rather than a `Text` node
specifically to get raw canvas access for this (`Konva.Context` proxies
`measureText`/`fillText`/`font`/`textAlign`/`textBaseline` straight
through to the real 2D context) — a plain `<Text>` has no way to
override its own metrics-based baseline positioning. Both engines run
the identical formula, so the editor and the print export always agree.

## MTG text fields

Text field placement/font/color is directory-driven and per-frame, the
same shape as the frame and font libraries:

```
text-template-library/
  _base.json       the default/fallback field set
  classic.json      override for frame-library/classic/'s frames
```

Each file is a JSON array of the standard fields (title, nickname, mana
cost, typeline, rules, flavor, power/toughness, edition, artist/credit,
signature) — each
field's `x`/`y`/`width`/`height` (mm, relative to the *cut* corner, not
the full-bleed canvas), `fontSizePt`/`fontWeight`/`isItalic`, `align`,
and `color` are independent values, not derived from a shared grid
formula — **except `rules`/`flavor`'s box, which is computed from the
surrounding fields rather than configured directly (see "Rules/flavor
text share one boundary box" below)**. That's deliberate: if one field
looks slightly off against a particular frame, open that frame's
category file and adjust just that field's numbers — nothing else
depends on them or needs to change in step. `flavor` starts
`isItalic: true` in both `_base.json` and
`classic.json` (conventional for MTG flavor text); every other field
defaults to `false`. `edition` sits directly above `artist`, and
`signature` sits inline with `artist` (same `y`) but right-aligned at
the opposite end of the row, bottom-right instead of bottom-left — for a
proxy-maker's own set/printing note and personal credit/signature, which
have no Scryfall equivalent (like `nickname`, both are excluded from the
Scryfall-import field mapping in `Toolbar.tsx`). `artist` and
`signature` also ship `locked`/`contentLocked` (see [Field
locking](#field-locking) below) — a signature or credit line shouldn't
move by accident, and by default only a premium account can rewrite
either one's text.

An optional `fontFamily` on a field overrides `DEFAULT_FONT_FAMILY`
(`config.ts`) just for that field — e.g. a script face for flavor text —
same "must actually be in the font catalog, or a system font" caveat as
`DEFAULT_FONT_FAMILY` itself applies. Omit it to just use the default;
none of the shipped fields set it.

An optional `shadow` on a field is that field's starting drop shadow —
whether it has one at all, and its exact look, is a per-field/per-frame
decision the same way font/size/color are, not a global setting. Shape:
`{ "color": "#...", "offsetXPt"?, "offsetYPt"?, "blurPt"?, "opacity"? }`
— `color`'s presence is the on/off switch (mirrors `TextLayer.shadowColor`
itself), the other four each independently fall back to `schema.ts`'s
`TextLayer` defaults (0/0/1pt/0.75) when omitted, so a field can just
name a color and inherit sensible sizing. None of the shipped fields set
it (most MTG text — rules, flavor, title over a normal frame — reads
worse with a shadow than without one); it's there for frames where it
helps, e.g. a title sitting directly over busy full-art.

**`minFontSizePt`/`maxFontSizePt` let short content grow to fill the
box, not just shrink when it overflows.** Every shipped field sets both
— e.g. `rules` is `fontSizePt: 8` with `minFontSizePt: 5` /
`maxFontSizePt: 10` — so a one-line ability fills more of the box at a
larger, more legible size instead of sitting fixed at 8pt with mostly
empty space below it, while a genuinely long rules-text block still
shrinks down toward the 5pt floor the way `overflow: "shrink"` always
has. The search always starts from `maxFontSizePt`, not `fontSizePt`,
whenever a range is set — so the properties panel's "Size (pt)" field
also moves `maxFontSizePt` along with it when editing a layer that has
one (and pulls `minFontSizePt` down too if it would otherwise exceed the
new size), rather than silently doing nothing visible the way it did
before this was added: without it, "Size" only ever fed the *ceiling*
`maxFontSizePt ?? fontSizePt` already used, so editing it while a
`maxFontSizePt` was set couldn't change what actually rendered. Omit
either bound (or both) on a field to keep the original
shrink-only-from-`fontSizePt` behavior exactly as it was — "Size" is a
plain, direct control again in that case. Editable per-layer too, not
just per-template: the properties panel shows "Min size"/"Max size"
fields under Overflow whenever a text layer's overflow is "Shrink to
fit."

Because inline symbols (see [Inline symbols in
text](#inline-symbols-in-text) above) size themselves to the current
font size (1em per symbol), a field that grows or shrinks to fill its
box carries its mana/tap/untap symbols along with it automatically —
there's no separate "symbol size" setting to keep in sync.

Run `pnpm sync-text-templates` any time you add a new `frame-library/`
category: it creates that category's `text-template-library/<category>.json`
as a verbatim duplicate of `_base.json` if one doesn't already exist yet
(never overwrites an existing one), then rebuilds the consolidated
`apps/editor/src/textTemplateCatalog.generated.json` every run. From
there, hand-edit the new category's file to fit that frame — the
duplicate is the whole point, it's a safe starting point that only
affects that one category.

**Editing an existing field's numbers day-to-day needs no command at
all.** `pnpm dev:editor` (`scripts/dev-editor.mjs`) starts the Vite dev
server *and* `scripts/watch-text-templates.mjs` together — the watcher
reruns the sync automatically the instant a file under
`text-template-library/` is saved, and Vite hot-reloads the regenerated
JSON straight into the running page (it's an ordinary JS module import,
so this is the same HMR path any other source-file edit gets — no
manual browser refresh either). Adjust a field's `x`/`y`/`color`/
whatever, save, and the *next* layer you add from that field picks it
up — a layer already placed on the canvas keeps whatever values it was
created with, since template config only supplies a starting point, not
a live binding. Driving Vite yourself instead of through `dev:editor`?
Run `pnpm watch-text-templates` alongside it for the same effect, or
fall back to plain `pnpm sync-text-templates` after each edit — it's the
same regenerate step, just triggered by hand instead of by a file save.

`Toolbar.tsx` resolves which field set applies from whatever Frame layer
is currently in the design (`activeFrameCategory`, via
`getFrameAsset(...).category`) — no frame present, or a category with no
override file yet, falls back to `_base.json`. The "Text Fields" toolbar
menu (`TextTemplateMenu.tsx`) converts a resolved template to an actual
text layer (offsetting by the cut-to-canvas margin, and using the
template's `color`) when you pick one, or all nine when you pick "Add
all fields" — the latter lands as a single undo step (`addLayers` in the
store), not nine.

**Shrink-to-fit runs live in the editor now, not just at export.** Text
boxes with `overflow: "shrink"` used to only actually shrink in the
`services/render` print export (`renderDesign.ts`'s `drawText`) — the
editor's Konva rendering just word-wrapped at the nominal font size
regardless of whether it fit the box, a real "what you see isn't what
prints" gap. Fixed by extracting the wrap/shrink loop into a shared,
engine-agnostic helper (`shrinkTextToFit` in
`packages/scene-schema/src/textFit.ts`, parameterized over a
`measureWidth`/`setFontSizePx` pair) that both `LayerNode.tsx` (using a
scratch, never-attached `<canvas>` 2D context to measure) and
`renderDesign.ts` (using its `SKRSContext2D`) now call — the two engines
have incompatible context types but an identical-enough 2D canvas text
API that duplicating the algorithm would've been the only alternative.
`LayerNode.tsx` also needed `useFontsReady()` (a small hook bumping state
on `document.fonts.ready`/`loadingdone`) since a shrink calculation that
runs once during React render, using a canvas context whose font hasn't
actually finished loading yet, gets wrong (fallback-font) metrics baked
in — unlike glyph painting, a later `stage.batchDraw()` alone doesn't
recompute it.

Fixing this surfaced a second, unrelated bug worth knowing about:
**`LayerNode.tsx` was converting `fontSizePt` to on-screen pixels at a
fixed 96 DPI, while every other measurement (the layer's box, via
`mmToStagePx`) used `EDITOR_DPI` (150).** Font size and box size were
each scaling from a different physical reference, so text rendered about
36% smaller on screen, relative to its box, than it does in the print
export — meaning a shrink threshold computed from these numbers would've
tripped at the wrong point. Fixed by deriving font size from
`EDITOR_DPI` too, the same as everything else on the canvas.

### Rules/flavor text share one boundary box

Unlike every other field, `rules` and `flavor` don't each get their own
fixed box — they share one automatically-computed boundary box and one
shared font size, laid out and re-fit by `rulesFlavorFit.ts`
(`computeRulesFlavorPatch`) rather than each independently shrinking
within whatever `x`/`y`/`width`/`height` the template gave it. That's
deliberate: two independently-shrinking boxes with independent font
ranges (the old behavior) meant rules and flavor routinely ended up at
visibly different sizes with an arbitrary gap between them — not how a
real MTG text box reads.

The box's bounds are computed, not configured directly: top is the
`typeline` layer's own bottom edge plus `gapAboveTypelineMm`; bottom is
whichever of `edition`/`artist`/`signature` sits topmost, minus
`gapAboveLegalMm`. `x`/`width` come from whichever of the two layers
already exists (rules, if both are being added together). All three gap
values are read only off the **`rules`** field's own template entry
(`gapAboveTypelineMm`, `gapAboveLegalMm`, `flavorGapLines` — see
`TextFieldTemplate` in `textTemplates.ts`), since the pair occupies one
shared region rather than each having its own; a template with no
`rules` entry, or missing either `typeline` or a legal-row field in the
current design, just never activates the coupling — rules/flavor (if
present independently) behave like any other field. `flavorGapLines` is
a multiple of the shared line height (default 2), not a fixed mm value,
so the gap between the two blocks scales with whatever size they end up
shrinking to.

Both fields, whichever are present, are laid out together and shrink as
one unit: `shrinkCombined` (`rulesFlavorFit.ts`) word-wraps rules and
flavor independently at the same candidate font size (each keeping its
own style — flavor is normally italic, rules normally isn't — via
`layoutText`, the per-size-only half of `textFit.ts`'s `shrinkTextToFit`
extracted so this could reuse it instead of re-implementing word-wrap)
and shrinks that shared size until rules-height + gap + flavor-height
fits the box. Only one of the two present (added independently, one at a
time) falls back to the ordinary single-box `shrinkTextToFit` against
the same computed box — no new algorithm needed for that case. The
shared ceiling both fields search down from is the *more restrictive* of
their two individually-configured `maxFontSizePt`s, not the more
permissive — since they're forced to one shared size, that size can
never legally exceed either field's own limit.

**Power/toughness avoidance is a true per-line notch, not a shortened
box.** When `powerToughness` is present and horizontally overlaps the
rules/flavor box, only the lines that actually reach down into its row
are narrowed to wrap around its left edge (plus `gapAboveLegalMm`'s
clearance, reused here as the P/T margin too) — everything above that
row still uses the box's full width, unlike an earlier version of this
feature that simply raised the whole box's bottom bound to clear P/T's
row entirely. `layoutText` (`textFit.ts`) takes this as
`avoidBelowYPx`/`avoidWidthPx`/`lineHeightPx`: a line whose bottom edge
falls at or past `avoidBelowYPx` wraps to `avoidWidthPx` instead of the
box's full width. `shrinkCombined` computes rules' own line count/height
first (needed to know where flavor starts), then re-bases the same
box-relative notch into flavor-local coordinates before laying flavor
out — both at every candidate font size in the shrink search, since the
notch's *position relative to whichever block it falls in* shifts as
rules' line count changes with size.

The notch itself is **stored on the layers, not recomputed at draw
time**: `avoidFromYMm`/`avoidWidthMm` (`TextLayer`, `schema.ts`) hold it
in each layer's own local coordinates (mm, relative to that layer's own
`y`), written by `computeRulesFlavorPatch` alongside the usual `x`/`y`/
`width`/`height`/`fontSizePt`. Both renderers (`LayerNode.tsx`,
`services/render`'s `drawText`) convert these two fields to px and pass
them straight into `shrinkTextToFit` whenever they're set — plain
rectangle wrapping otherwise — so neither renderer needs to know
`powerToughness` exists, look up sibling layers, or read template data;
they stay exactly as "dumb" as every other field, just with two more
optional numbers to forward. A patch that no longer needs the notch (P/T
moved away or was removed) sets both fields to `undefined` explicitly
rather than omitting them, clearing any stale notch from a prior fit.

The result is written directly onto the `rules`/`flavor` `TextLayer`s'
own `x`/`y`/`width`/`height`/`fontSizePt`/`avoidFromYMm`/`avoidWidthMm`
— computed once instead of live — so `LayerNode.tsx` and
`services/render` need no *rules/flavor-specific* rendering logic at
all; they just draw whatever's stored, like any other text field, using
the same generic notch support any text layer could use. Runs whenever
there's something to (re-)fit: `Toolbar.tsx`'s
`addAllTextFields`/`addTextField`/`importFromScryfall` fold the patch
into the very layers they're about to commit rather than a separate
follow-up commit (so e.g. "Add all fields" stays one undo step), and
`PropertiesPanel.tsx`'s content textarea re-fits live while typing into
either field, in the same `beginLiveEdit`/`updateLayerLive`/
`commitLiveEdit` session as the edit itself — still one undo step once
the field loses focus, not one per keystroke.

## Scryfall import

> Since the fork: this now lives in `packages/plugin-scryfall-import/`
> as an `ImportSourcePlugin` (see [Plugin system](#plugin-system)), not
> in `apps/editor` — the file names below (`scryfall.ts`,
> `ScryfallSearchModal.tsx`) are unchanged, just moved. Everything this
> section describes about the actual import behavior is still accurate.

The toolbar's "Import" button opens a search box (`SearchModal.tsx`)
against [Scryfall's public card API](https://scryfall.com/docs/api) — no
API key, CORS-enabled for direct browser calls (`scryfall.ts`). Type a
card name, pick a result, and it adds — as a single undo step — whichever
of the following the card actually has data for:

- Title, mana cost, type line, rules text, flavor text, power/toughness,
  and artist credit, each as a text layer built from the current
  frame's resolved template (see [MTG text fields](#mtg-text-fields)) —
  same placement/font/color a manually-added field would get, just with
  Scryfall's content instead of the template's placeholder text. A field
  with no data (e.g. no flavor text) is skipped outright rather than
  adding an empty/placeholder layer. There's no template field for a
  nickname, so that one's never filled from Scryfall.
- The card's own illustration (`image_uris.art_crop` — just the
  artwork, no card border around it) as an Image layer, `fit: "cover"`
  sized to the current frame category's illustration window
  (`resolveArtWindowMm` in `frameArtWindow.ts`) rather than the full
  full-bleed card — `art_crop` is a landscape crop of just the
  illustration, a much wider aspect ratio than the card itself, so
  stretching it full-bleed the way a manual full-card-scan upload
  defaults to (see `addImage` in `Toolbar.tsx`) forced it through a
  tall, narrow box and cropped away roughly half of it on the sides.
  `resolveArtWindowMm` falls back to `classic`'s window (measured from
  its PNG's alpha channel) for any frame category without a dedicated
  entry of its own — add one there for a category whose window sits
  somewhere meaningfully different. Inserted *beneath* the frame layer
  if one exists (splicing into the layer array, not appended) so the
  frame's transparent art window shows it, instead of covering the
  frame the way appending on top would.
- The rarity symbol, if `rarity` matches a `rarity-library/` id (common/
  uncommon/rare/mythic already do) — reuses the same find-or-create
  logic the rarity dropdown itself uses (`buildRarityLayer`, extracted
  so both places build an identical layer shape).

`addLayers`/`addLayersWithGroups` (used by "Add all fields", see [Layer
groups](#layer-groups)) always append new layers at the top of the
z-order, which can't express "art below the frame, text above it" in a
single step — that combination needed a new store action,
`replaceLayers(layers, selectIds)`, that commits a caller-computed full
layer array as one undo step instead.

**Mana cost and rules text map straight across almost for free** — this
is why the inline-symbol token syntax (`{W}`, `{T}`, ...) was worth
matching exactly to Scryfall's own: `mana_cost` and `oracle_text` already
come back in that same curly-brace notation, so no translation step
exists between "what Scryfall returns" and "what the text layer renders
as symbols."

Double-faced cards (transform, modal DFCs, ...) fall back to
`card_faces[0]` for any field missing at the top level — Scryfall does
this itself for `mana_cost`/`type_line`/`oracle_text`/power/toughness on
these cards. Only the front face is used; there's no UI yet for picking
a specific face.

**Not verified against the live API from this environment** — this
sandbox's outbound network policy blocks `api.scryfall.com` (confirmed:
a direct request here gets rejected at the network layer), so the search/
fetch/field-mapping/layer-creation pipeline was verified instead by
mocking both endpoints with a fixture matching Scryfall's real response
shape (`page.route()` in a throwaway Playwright script). The endpoint
URLs and response shape are Scryfall's stable, long-documented public
API; worth a real end-to-end smoke test once this runs somewhere with
normal internet access.

### Generalized into `applyGeneratedFields` for the AI card-generation wizard

Everything above — text-field placement, the art layer's frame-window
sizing, the rarity symbol, and the default groupings — used to live
directly inside `importFromScryfall`, hardcoded to a `ScryfallCard`.
It's now `applyGeneratedFields(fields: GeneratedCardFields,
frameAssetId?)` (`Toolbar.tsx`), a generic version keyed on
`GeneratedCardFields` (`generatedCardFields.ts`) — the same handful of
fields (name/manaCost/typeLine/rulesText/flavorText/powerToughness/
artist/rarity/imageSrc), just decoupled from Scryfall's response shape.
`importFromScryfall` is now a thin adapter: `primaryCardFields(card)` →
`applyGeneratedFields({...})`.

The second (and motivating) caller is moxproxies-website's AI card-
generation wizard, wired through `<card-studio-editor>`'s
`generated-fields` JSON attribute (embed.ts) — see [How this is meant to
connect to
moxproxies-website](#how-this-is-meant-to-connect-to-moxproxies-website).
Read once at mount into `designStore.ts`'s `pendingGeneratedCard`, and
applied by a one-time effect in `Toolbar.tsx` before the shopper ever
sees the canvas — the resulting layers *are* the design's first state,
not a separate action they have to trigger themselves. Unlike Scryfall
import (which only ever applies against whatever frame, if any, is
already on the canvas), the wizard is building a design from nothing, so
its payload can also carry a `frameAssetId` — when present,
`applyGeneratedFields` adds that frame layer first and lays fields out
against its category, rather than the (necessarily frame-less) current
one.

## Layer groups

A group is a name plus a set of layers — `Design.groups: { id, name }[]`
is the registry, and each `Layer` carries an optional `groupId` pointing
into it (`packages/scene-schema/src/schema.ts`). It's an organizational
label, not a transform hierarchy: z-order is still just `layers` array
order (a group doesn't nest its members under a parent transform), and a
grouped layer's own x/y/rotation stay completely independent of its
groupmates'. What grouping actually buys you is in the layer panel — a
shared header (name, visible/lock toggles that apply to every member at
once, ungroup, delete-group-and-contents) and bulk drag-reordering (the
whole group moves as one block).

**Layers sharing a groupId are expected to sit contiguous in `layers`.**
`LayerPanel.tsx` derives what to render by walking the array and
clustering *consecutive* same-groupId layers into one block — there's no
separate membership list it cross-checks against, so this is really an
invariant the code that creates groups has to uphold, not something
enforced structurally. `groupContiguous` (`designStore.ts`) is the one
place that assigns a groupId, and it always moves the named layers
next to each other first (near the topmost original member's position,
not jumping the block to the very front/back of the stack) before
tagging them — `groupLayers` (the properties panel's "Group" button,
for an ad hoc multi-select), `addLayersWithGroups` ("Add all fields"'s
default groupings, see below), and `replaceLayers`'s optional
`groupDefs` param (Scryfall import's default groupings — same feature,
different store action, since import needs `replaceLayers`'s more
general "commit an arbitrary rebuilt layer array" for other reasons,
see below) all go through it. A groupId that somehow ended up
non-contiguous (there's no code path that produces this today) would
just render as more than one same-named cluster instead of corrupting
anything.

**"Add all fields" and Scryfall import both group the same three pairs
by default**: Title+Mana Cost, Typeline+Rarity, and Rules+Flavour.
Everything else either one can add (Nickname, Power/Toughness,
Artist/Credit, Signature) stays ungrouped. The rarity symbol is a
pre-existing singleton layer (`RARITY_LAYER_ID`, see [Adding/changing
rarity symbols](#addingchanging-rarity-symbols)), not one of
`textTemplates`' own fields, so there's nothing to group Typeline
*with* unless one already exists — "Add all fields" creates a default
`common`-rarity layer first if the design doesn't have one yet, and a
Scryfall card's own rarity becomes that layer if the design doesn't
have one yet (or updates an existing one in place) as part of the same
import. Both callers handle "a brand new rarity layer added in this
same action" and "an already-present one from earlier" identically and
atomically: build/append the full layer set first, then run
`groupContiguous` once per default pairing over that combined list, all
as a single undo step.

Scryfall import's groupings are a strict subset of "Add all fields"'s,
though: only pairs where *both* members actually got imported — a card
with no flavor text never gets a "Rules and flavour" group, since
there'd only be one real member. `groupContiguous` already silently
skips (no-ops) any def that resolves to fewer than two real layers, so
`importFromScryfall` (`Toolbar.tsx`) doesn't need to special-case this
itself — it can always pass "Typeline and rarity", say, whenever
typeline was imported, and trust the no-op for a card with no
recognized rarity.

**Drag-and-drop reordering is native HTML5 DnD, not a library** — no new
dependency, and the interaction is simple enough (reorder a flat list of
rows) not to need one. The drag handle (`GripVertical` icon) is the
`draggable` element, not the row itself, so a drag can only start from
that small grip — the row's own click-to-select and its icon buttons
are completely unaffected. Only *top-level* rows (a standalone layer, or
a whole group treated as one block) are drag-reorderable; within a
group, the small up/down buttons on each member row are the only way to
reorder — there's no drag-within-a-group in this version.

**A group's drop zone covers its whole rendered block, header down
through its last member row — not just the header.** `rowDropProps`
(the `onDragOver`/`onDrop` handlers) is on the outer wrapper `<div>` that
contains both the header and the member rows, not the header alone.
Attaching it only to the header initially meant there was nowhere to
drop *below* a group that happened to be the last thing in the panel —
member rows had no drag handlers of their own for the drop to bubble
through, so a drag hovering over them (which is most of a group's
height) registered no valid target at all, making "move something to
the very back of the stack" impossible whenever a group was last.

**Groups are collapsible** — a chevron button in the header (left of the
folder icon) toggles whether member rows render at all;
`collapsedGroupIds` is local `LayerPanel` component state (a `Set`, not
in the design store), the same "view-only, doesn't need undo history or
to survive a reload" treatment as `showSafeArea`/`showBleed`, just
scoped to this one panel instead of shared app-wide.

**A group header's un-selected background used to read as selected.**
It was tinted `var(--cs-surface-soft)` (a step darker than the plain
panel background, meant to read as "this is a header") even when
nothing in the group was selected — chosen before `--cs-accent-soft`
(the actual selected-row color) existed in the same warm palette, the
two ended up close enough in hue and lightness that a header looked
selected at a glance regardless of actual selection state. Fixed by
dropping the default background to `transparent`, matching every other
unselected row — the bold text, folder icon, and collapse chevron
already read as "header" on their own, without needing a background
tint to reinforce it.

## Save/load

> Since the fork: this swap has now been made. `apps/editor` calls
> `backend/`'s `card_designs` API (see [Backend (API)](#backend-api))
> whenever a shopper is signed in — `AccountButton.tsx` handles
> register/sign-in against `POST /api/auth/register`/`/login`, stores
> the returned Sanctum bearer token, and restores the session from it on
> load. Everything below describing `designStorage.ts` as a single
> `localStorageDesignStorage` implementation is the *pre-swap* state,
> kept for context; see the "now" paragraph right after it for what
> actually runs today.

`designStorage.ts` started as a small interface (`list`/`load`/`save`/
`remove`) with one implementation, `localStorageDesignStorage` — "save"
meant the browser's `localStorage`, one JSON blob holding every save
keyed by `design.id`. `DesignLibraryModal.tsx` (the toolbar's "Designs"
button) is the only consumer, and it only ever talks to the
`DesignStorage` interface, never to `localStorage` or the API directly —
which is exactly what made the later swap possible without touching the
modal. Loading always goes through `Design.parse()`, so a save made by
an older version of this app (missing a field a newer schema added
since) still loads cleanly — the same defaulting behavior the embed's
`initial-design` attribute and the render service's request body
already rely on.

**Now:** `designStorage.ts` exports a module-level `active` binding
(default `localStorageDesignStorage`) behind `setActiveDesignStorage()`,
and the `designStorage` object `DesignLibraryModal.tsx` imports just
proxies to whichever implementation is currently active — so that
import stays one stable reference no matter which backend is live.
`AccountButton.tsx` calls `setActiveDesignStorage(apiDesignStorage)` on
sign-in and flips it back to `localStorageDesignStorage` on sign-out.
`apiDesignStorage` (`apps/editor/src/api/apiDesignStorage.ts`) implements
the same four methods against `backend/`'s upsert-by-id `card_designs`
routes, so anonymous use still works exactly as before (local-only,
per-browser) and signing in is what makes designs follow the account
instead.

Saving/loading/starting a new design all confirm first if the current
design might have unsaved changes (a plain `window.confirm`) — loading a
different design, or starting a blank one, clears undo/redo history
(`loadDesign` in `designStore.ts`), so there's nothing to Ctrl/Cmd+Z
back to once you've navigated away from what you had.

**moxproxies-website's real integration ended up bypassing this
interface entirely, rather than swapping its implementation as
originally planned above.** The host page already has everything it
needs from `.getDesign()`/the `design-change` event (see [How this is
meant to connect](#how-this-is-meant-to-connect-to-moxproxies-website))
and posts straight to its own backend — there was never a need for a
`CardDesign`-backed `DesignStorage` implementation living inside this
app. What *is* needed: hiding the toolbar's own "Designs" button
(`localStorageDesignStorage`, still exactly as described above) so it
doesn't sit next to the host's real "Save" button as a second one that
silently only persists to that browser — `<card-studio-editor
hide-local-design-library>` (embed.ts) does that, defaulting to shown
(unchanged) for the standalone dev entry point, which has nothing else
to defer to.

## Field locking

Every layer carries two independent booleans (`LayerBase.locked` /
`LayerBase.contentLocked`, `packages/scene-schema/src/schema.ts`), not
one — they answer two different questions:

- **`locked`** — can this layer be *moved, resized, or rotated*? Checked
  everywhere a layer's transform can change: `LayerNode.tsx`'s
  `draggable`, `CanvasStage.tsx`'s `attachTransformer` (a locked layer is
  excluded from the Konva `Transformer`'s node list entirely, so its
  resize/rotate handles don't even appear), `designStore.ts`'s
  `nudgeLayers` (arrow-key nudge), and the properties panel's X/Y/Width/
  Height/Rotation number inputs (`disabled` whenever `layer.locked`).
  **Never gated by any user entitlement** — anyone can flip it via the
  lock icon in the layer panel or properties panel, regardless of
  `contentLocked` or the current user's access level. This is the "don't
  let a signature drift off its corner by an accidental drag" lock.
- **`contentLocked`** — can this layer's *content* be edited (a
  `TextLayer`'s text; a `FrameLayer`'s frame art; the rarity dropdown,
  for the one designated rarity/set-symbol layer)? When true, editing
  additionally requires `Entitlements.canEditLockedContent` — the
  "premium" gate. The properties panel's Content textarea, its "Change
  frame…" button, and the rarity `<select>` are all `disabled` whenever a
  layer is `contentLocked` and the current entitlements say no, and the
  Content field's label shows a lock icon (filled accent color if the
  current account can edit anyway, muted if not) so it's visually obvious
  a field is gated even before you try typing into it. Toggled from the
  properties panel next to the position lock — asymmetric on purpose:
  turning it *on* is ungated, turning it *off* needs
  `canEditLockedContent`, or the premium gate would be one click from
  being switched off by the accounts it applies to.

A layer can be `locked` and not `contentLocked`, `contentLocked` and not
`locked`, both, or neither — the two never imply each other. The spec
this followed: premium should let an account rewrite text that's
otherwise fixed (a legal line, a signature), but should never let *any*
account casually drag that same text out of position — hence two
separate flags instead of one.

**`Entitlements`** (`apps/editor/src/entitlements.ts`) is a small,
deliberately dumb interface — `{ canEditLockedContent: boolean;
canGenerateAiArt: boolean }` — not a token, session, or user object. Card
Studio has no auth of its own (see [How this is meant to connect to
moxproxies-website](#how-this-is-meant-to-connect-to-moxproxies-website)),
so it never decides who's premium; it just holds the boolean answers and
reacts to them. `DEFAULT_ENTITLEMENTS` (both flags `false`) is what a
design starts with absent any other signal.
`designStore.ts`'s `createDesignStore` takes an optional initial value,
and the store exposes a `setEntitlements` action for changing it later —
`<card-studio-editor>` (`embed.ts`) surfaces both halves of that for each
flag: a boolean attribute read once at mount (`can-edit-locked-content`,
`can-generate-ai-art`; for a host that already knows the answer
synchronously) and a `.setEntitlements()` method for calling any time
after (for a host resolving an async auth/subscription check).
moxproxies-website's real Stripe-backed premium check
(`User::isPremium()`, see [AI art generation](#ai-art-generation)) drives
both flags from the same subscription state, computed server-side and
passed in one of those two ways — nothing on the Card Studio side needs
to change as that check evolves. The standalone dev entry point
(`main.tsx`, `pnpm dev:editor`) has its own throwaway wiring for this —
`?premium=1` in the URL — that's local-only scaffolding, not part of the
embed's real integration surface.

**`artist`, `signature`, and the rarity/set-symbol layer default to both
locks on.** The first two via their `text-template-library/*.json`
entries (`TextFieldTemplate.locked`/`.contentLocked`, consumed by
`templateToLayer` in `Toolbar.tsx`); the rarity layer isn't
template-JSON-driven (it's a singleton, not one of `textTemplates`'
fields — see [Adding/changing rarity
symbols](#addingchanging-rarity-symbols)), so its defaults live as named
constants instead, `RARITY_DEFAULT_LOCKED`/`RARITY_DEFAULT_CONTENT_LOCKED`
in `rarityConfig.ts`. Every other shipped field defaults both flags to
`false` (freely movable and editable, the pre-existing behavior). A
frame category's own `text-template-library/<category>.json` can set
different defaults per field the same way any other per-field value is
overridden.

Implementing `locked` as a real, complete guarantee (not just "can't
drag on canvas") surfaced three pre-existing gaps, fixed alongside this
feature: `nudgeLayers` didn't check `locked` at all (arrow keys could
still move a "locked" layer); `attachTransformer` attached every
selected node to the `Transformer` regardless of `locked`, so resize/
rotate handles stayed active even though drag was already correctly
blocked; and the properties panel's X/Y/Width/Height/Rotation inputs had
no `disabled` gating on `locked` at all, so retyping coordinates by hand
always worked regardless of the lock.

## Moderation

Staff-only tooling, built as **"the founders review a queue"** — the
choice `docs/PRODUCT_VISION.md` leaves open, and the one that needs the
least tooling to be safe. **Nothing is automated:** no auto-hiding at a
report threshold, no heuristics. A human reads a report and decides. If
that stops scaling, the queue is where automation attaches.

`users.is_staff` is the whole permission model — one privileged role, so
no roles table. It is deliberately **not mass-assignable**; a founder
grants it directly:

```sh
php artisan tinker --execute='$u = App\Models\User::where("email","…")->first(); $u->is_staff = true; $u->save();'
```

`EnsureStaff` answers **404, not 403** — a 403 tells a prober the
moderation surface exists. Hiding the tab in the UI is presentation; the
404 is the boundary.

| action | effect |
| --- | --- |
| **Takedown** | hides content from everyone *including its owner*, and reverses the points it earned. Requires a stated reason. |
| **Suspend** | blocks every authenticated request (`BlockSuspendedUsers`) and hides the profile. Deletes nothing, so it's reversible and an appeal has something to look at. The token isn't revoked, so reinstating doesn't force a re-login. |
| **Appeal** | granted (which reinstates) or declined, with a response the appellant reads. See below. |
| **Resolve** | marks a report reviewed/actioned/dismissed. Never touches content — a takedown is a separate, explicit call. |
| **Badges** | grants or revokes the manual badges. Rule-based ones are refused: hand-granting one would be a lie the next evaluation disagrees with. |

Every action writes a `moderation_actions` row — append-only, like the
points ledger, because a decision you can quietly edit afterwards isn't
an audit trail. Undoing is a new row.

Staff can't suspend staff or themselves: two people arguing with the
suspend button is not a moderation process.

### Appeals

A suspended account can contest the decision, which is what stops a
suspension being a black box. It works because sign-in still *succeeds*
while suspended — authentication passes, authorisation fails — so the
account keeps a token, and three routes sit outside `BlockSuspendedUsers`:
signing out, reading your appeal, and filing one. Everything else 403s
with `suspended: true` in the body, which is what tells the app to show
the suspension screen rather than a generic error.

One open appeal at a time (a queue where one person can file fifty is a
queue nobody reads), re-appealing after a denial is allowed, and a
decision needs a written response either way — "no" with no reason is
what makes someone file the same appeal five more times. **Granting
reinstates the account in the same call**: as two calls, the way it fails
is a granted appeal nobody remembered to act on.

## Knowledge base

Community guides — printing, cutting, card stock, design tips. A post is
another owned-and-publishable type (`OwnedByUser` + `Publishable` +
`Reactable`), so likes, reports, visibility, moderation state, featuring
and profile listings all came for free. What's specific to it:

- **A slug, generated once from the first title and never changed.**
  Renaming a guide keeps its URL rather than breaking every link to it.
- **Edit history.** A `post_revisions` row is written *before* each
  change, so it holds the superseded version. This is a moderation
  feature — "what did this say before it was edited" can't be answered
  retroactively — and is owner-only until there's a staff role.
- **Comments**, polymorphic like reactions and reports, so a thread can
  attach to a design later. A commenter can delete their own; so can the
  post's author, since a thread on your guide is yours to keep clean.
- Categories come from `config/knowledge_base.php` — a shortlist, not a
  table, same call as report reasons.

**Markdown is rendered to React elements, never to an HTML string** —
`apps/editor/src/markdown.tsx`, no `dangerouslySetInnerHTML` anywhere.
Post bodies are user-generated and public, so the usual markdown→HTML
path would need a sanitizer, and a sanitizer is a thing you can get
subtly wrong. Building React nodes makes injection impossible by
construction; link hrefs are still scheme-allowlisted, because
`javascript:` in an href isn't markup injection. Supported: headings,
lists, quotes, fences, rules, and inline bold/italic/code/links.

| route | auth | notes |
| --- | --- | --- |
| `GET /api/posts` | — | `?q=&category=&tag=&sort=` |
| `GET /api/posts/{slug}` | optional | by slug; drafts are owner-only |
| `GET/POST /api/posts/{slug}/comments` | read: — | posting needs an account |
| `PUT /api/posts/{id}` | ✓ | upsert; records a revision on a text change |
| `GET /api/posts/{id}/revisions` | ✓ | owner-only |
| `DELETE /api/comments/{id}` | ✓ | commenter or post author |

## App shell (standalone app)

`pnpm dev:editor` serves an **app**, not a canvas with dialogs stacked on
it: five destinations you navigate between, deep-linked in the URL hash.

| | |
| --- | --- |
| **Design** | the editor |
| **Library** | saved designs + collections |
| **Templates** | the community gallery |
| **Guides** | the knowledge base |
| **Profile** | yours, or whoever you tapped through to |

Below 768px navigation is a **bottom tab bar** (thumbs reach the bottom
of a phone); above it, a **website-style top nav**. One breakpoint,
`shell/useIsNarrow.ts`.

Routes live in `shell/navStore.ts` and mirror to the hash — `#/templates`,
`#/u/:username`, `#/guides/:slug` — so a profile or guide can be linked
to and survives a reload. A hash rather than paths: the bundle is static
and can sit at any base path without a server rewrite.

Dialogs still exist for things that genuinely are one — signing in,
saving a template, filing a report. The rule: a **destination** is
somewhere you browse; a **dialog** is a task you finish and dismiss.

**The editor stays mounted** across navigation (hidden, not unmounted) —
glancing at the gallery must not throw away the design in progress or
its undo history.

**The embed doesn't use any of this.** `<card-studio-editor>` renders the
editor alone with its own toolbar buttons and its own dialogs — a host
page has its own navigation. That's why the big surfaces are chrome-free
panels (`TemplatesPanel`, `LibraryPanel`, `ProfilePanel`) that take a
render prop: one implementation, rendered as a page by the shell and as a
dialog by the embed.

**The editor is responsive too.** Below 768px its three panes collapse to
a full-bleed canvas plus a bottom sheet holding Layers *or* Properties,
switched by a segmented control (`App.tsx`). The sheet caps at 46vh so
the canvas never disappears behind it, and the toolbar scrolls sideways
rather than wrapping into rows that eat the canvas.

Touch targets (44px floor) key on `@media (pointer: coarse)`, not the
viewport: a small window on a desktop still has a mouse, and a landscape
tablet is wide but finger-driven. `useIsNarrow` lives in `hooks/`, not
`shell/`, because an embedded editor on a phone has no shell but is just
as narrow.

Re-selecting the tab you're already on remounts the view and refetches
(`navStore`'s `epoch`) — the behaviour every app has, and the only way to
notice that something you're looking at changed elsewhere.

## Points, levels & badges

One generic system, not four. **All the numbers live in
`backend/config/gamification.php`** — points per action, the level
thresholds, the featuring gate — because they're a product decision, not
a code one. Nothing reads a hardcoded value anywhere else.

**Reactions** are one polymorphic table, one endpoint (`POST
/api/reactions`, toggles and returns the resulting state) and one
component (`ReactionButton.tsx`) across designs, templates and
collections. Posts join in Phase 5 by adding `use Reactable` to a model.

**Points are an append-only ledger** (`point_events`), never an integer
column — so "why am I level 3" is answerable by reading rows. Two rules
worth knowing:

- Every award carries a `dedupe_key`, so awards are exactly-once.
  Unliking and re-liking can't farm points; nor can unpublishing and
  republishing.
- **Awards are never taken back.** Un-reacting doesn't subtract, because
  "your total dropped because a stranger changed their mind" is a worse
  property than "an early like still counts". The `amount` column is
  signed so moderation *can* reverse, by appending a negative row.

Reacting to your own work is worth nothing, and `template_used` only
awards for a signed-in use (the endpoint is deliberately open, so an
anonymous award would be farmable in a loop).

**Levels** are a pure function of the total against the thresholds
table. **Badges** are their own entity, awarded either by a rule in
`App\Support\BadgeRules` or by hand — both modelled from the start,
since "Pillar" is never going to be automatable. The catalog is seeded
in the migration, so `php artisan migrate` remains the whole setup step.

**Featuring** is the one perk levels unlock: pin your own published work
to your profile, above a configured level and up to a configured count.

| route | auth | notes |
| --- | --- | --- |
| `POST /api/reactions` | ✓ | `{type, id}`; toggles |
| `POST /api/featured` | ✓ | `{type, id, featured}`; level-gated |
| `GET /api/badges` | — | the catalog |

Profile responses carry `stats`, `badges` and `featured`; listings carry
`reaction_count` and `reacted`.

## Authentication

Email + password, or **sign in with Google / GitHub**. A provider is
enabled *by being configured* — no client id, no button and no working
route (`config/services.php`, `App\Support\SocialProviders`), so a
half-configured provider never appears as an option that dead-ends.

The OAuth flow has to work for a bearer-token API with no session, and
four things in it are load-bearing:

- **The return URL is allowlisted** (`FRONTEND_URLS`). Unchecked, the
  callback is an open redirect that hands a valid token to any host.
- **The token comes back in the URL fragment**, not the query — a
  fragment isn't sent to servers and doesn't reach access logs or a
  `Referer`. The app claims it and scrubs it from history immediately.
- **State is a single-use server-side nonce.** Socialite's own state
  lives in a session this API doesn't have, so `stateless()` is required
  — which means replacing the CSRF protection, not dropping it.
- **An existing account is only linked by email when the provider
  verified it.** Otherwise anyone who can set an unverified address at a
  provider could sign in as that user. Google reports `email_verified`;
  GitHub only returns a primary address it has verified. An unknown
  provider counts as unverified.

A social-only account has `password = null` — password sign-in then says
*"this account signs in with Google"* rather than "wrong credentials",
because otherwise you're guessing at a password that was never set.

**Hardening.** Passwords need letters and numbers, not just 8 characters
(`12345678` passes a bare length check and is among the first guesses
anyone makes). Login is rate-limited **by email *and* IP** — by IP alone,
one attacker behind a NAT locks out everyone sharing that address, and it
does nothing about a distributed attempt on one account.

**Sessions.** Tokens expire (30 days, `SANCTUM_TOKEN_TTL_MINUTES`) — a
bearer token that never does is a permanent credential sitting in a
browser's `localStorage`. Each one is named for the device that asked for
it, so the account's own **signed-in devices** list reads "Chrome on
macOS" rather than four rows of "api", and any one of them can be revoked
on its own. "Sign out everywhere" is still there for when you'd rather
not work out which row is the problem. Expiring doesn't delete the row,
so `sanctum:prune-expired` runs daily (`routes/console.php`).

The linking rules are covered by `backend/tests/Feature/SocialAuthTest.php`
with a mocked provider — including the takeover case — since a live OAuth
round-trip can't be part of every run.

### Transactional email (Brevo)

Two emails: **verify your address** and **reset your password**. Both go
out over Brevo's SMTP relay, configured entirely through `.env` (see
`backend/.env.example`) — Laravel's own mail stack, no SDK. `MAIL_MAILER`
defaults to `log`, so a dev box writes the email to `storage/logs`
instead of mailing a real person.

- Links are **signed and expiring** (`URL::temporarySignedRoute`, 60
  minutes) — verification carries a hash of the address it was issued
  for, so it stops working if the address changes.
- **Forgot-password answers identically whether or not the account
  exists.** A different response is a membership oracle.
- Completing a reset **revokes every token**, since the likeliest reason
  to reset is that someone else has one.
- Sending is **best-effort at registration**: a Brevo outage must not
  fail a signup. The account exists unverified and can ask again.
- The two routes have **separate rate limits** — requesting a reset is
  mail sent to an address the caller names (3/min per email+IP), while
  completing one needs a valid single-use token (10/min per IP). Sharing
  a bucket meant asking for a reset could use up your ability to finish
  one.

Verification is not yet enforced anywhere: an unverified account is
prompted on its profile but nothing is gated on it. Gate what should be
gated when there's a reason to.

`php artisan auth:reset-link <email>` prints the link an operator (or a
test) needs without going through mail at all.

## Accounts & profiles

Every account has a **username** (the public handle a profile is
addressed by, auto-generated from the display name at signup and
editable after), plus an optional bio and avatar URL. `name` stays
free-text and non-unique; `username` is the unique one.

`GET /api/users/{username}` is public and returns the profile plus
everything that account has published — templates and designs both.
`email` can never appear there: `User::$hidden` drops it, and the three
auth endpoints that legitimately need it add it back explicitly.

**Visibility is one vocabulary** across every content type
(`App\Models\Concerns\Publishable` on the backend, `visibility.ts` on
the frontend): `private` / `unlisted` / `published`, with
`moderation_state` overriding all three. Only `published` is listed;
`unlisted` is fetchable by id. Designs get the same per-row visibility
dropdown templates have, and the same `POST .../publish` endpoint (both
inherit it from `OwnedContentController`).

**Reports** are one polymorphic table and one endpoint (`POST
/api/reports`, auth'd, rate-limited) covering templates, designs and
accounts — collections and posts later. Filing a report stores a row and
nothing else: no auto-hiding, no notification. The queue that acts on
them is Phase 4/6; the point of having it now is that nothing became
public without somewhere for a complaint to go.

| route | auth | notes |
| --- | --- | --- |
| `GET /api/users/{username}` | — | profile + published templates/designs |
| `PATCH /api/profile` | ✓ | name, username, bio, avatar_url |
| `POST /api/reports` | ✓ | `{type, id, reason, details}`; re-reporting updates |
| `POST /api/card-designs/{id}/publish` | ✓ | visibility only |

**UI.** The toolbar account button opens the profile editor; the author
credit on any gallery row opens that person's public profile, where
their templates can be used directly. Report buttons sit on other
people's templates and profiles, never your own.

## Collections

A collection is a named group of the owner's **own** designs — a binder,
a deck, a set. Almost no code of its own: `OwnedByUser` +
`Publishable` + `OwnedContentController` give it the UUID key,
ownership scoping, the visibility vocabulary, moderation state, and
publish/delete for free. What's specific is the membership pivot
(`card_design_collection`, hand-ordered by `position`) and one rule:

> A published collection can hold private designs. Everyone except the
> owner sees only the ones they could open anyway — **and a count that
> matches**, since an unfiltered count would leak how many private
> designs are in there. `Publishable::scopePubliclyReadable` is the
> query-side twin of `isPubliclyReadable()`; keep them in step.

| route | auth | notes |
| --- | --- | --- |
| `GET /api/collections/{id}` | optional | with its designs, filtered for the viewer |
| `GET /api/collections` | ✓ | mine, with counts |
| `PUT /api/collections/{id}` | ✓ | upsert by id |
| `PUT/DELETE /api/collections/{id}/designs/{designId}` | ✓ | membership; both sides owner-scoped |
| `POST /api/collections/{id}/publish` | ✓ | visibility only |
| `DELETE /api/collections/{id}` | ✓ | doesn't delete the designs |

**UI.** A "Collections" tab in the Designs dialog: create, publish,
delete, and file the design you're editing into one. Published
collections appear on the public profile.

## Community templates

A **template is a `Design` plus publishing metadata** — no second scene
format, no slot schema. The two lock flags every layer already has (see
[Field locking](#field-locking)) are the whole mechanism:

| layer flags | role | who can change it |
| --- | --- | --- |
| `locked` + `contentLocked` | fixed chrome (frame art, rarity symbol) | nobody |
| `locked` only | a fill-in slot | its *value*, not its position |
| neither | freely movable | anything |

Both flags toggle from the properties panel, so authoring a template is
the normal editor plus two clicks per layer.

`cardTemplates.ts` holds that mapping (`classifyTemplateLayer`,
`summarizeTemplateLayers`) and `designFromTemplate`, which is all "new
design from template" is: spread the template's `design`, new
`Design.id`, `Design.parse()`. Lock flags carry through as authored.
Layer ids are kept, not regenerated — they only need to be unique within
one design, and keeping them keeps `RARITY_LAYER_ID`, `groupId`, and
`fieldId` valid.

**UI.** A toolbar "Templates" button (same `hideLocalDesignLibrary` gate
as "Designs") opens `TemplateBrowserModal.tsx`: a **Community** tab
(published gallery, search + sort) and **My templates** (all
visibilities, with visibility/update/delete per row). "Use" clones into
a fresh design and loads it. "Save current design as template" opens
`SaveAsTemplateModal.tsx`, which reports the chrome/slot/unlocked
breakdown instead of offering a slot-definition mode. Browsing and using
work signed out; publishing doesn't.

**Backend.** `templates` mirrors `card_designs` (client UUID key,
PUT-upsert-by-id, opaque `design`) plus `description`, free-text `tags`,
`visibility` (`private`/`unlisted`/`published`), `usage_count`,
`version`, and a `moderation_state` column present from the first
migration so a takedown has somewhere to write.

| route | auth | notes |
| --- | --- | --- |
| `GET /api/templates/browse` | — | published only; `?q=&tag=&sort=recent\|popular&limit=` |
| `GET /api/templates/{id}` | optional | with `design`; private is owner-only |
| `POST /api/templates/{id}/use` | — | bumps `usage_count`, rate-limited |
| `GET /api/templates` | ✓ | my templates, all visibilities |
| `PUT /api/templates/{id}` | ✓ | `version` bumps only if `design` changed |
| `POST /api/templates/{id}/publish` | ✓ | visibility only, no design re-upload |
| `DELETE /api/templates/{id}` | ✓ | |

Every row carries its author's name — community templates are
attributed, never presented as first-party.

**Deferred:** visual slot-constraint authoring, migrating designs when a
template changes (`version` is a human marker, nothing reads it), and
fork/remix lineage.

## AI art generation

Toolbar.tsx's "AI Art" button opens `AiArtModal.tsx` — a free-text prompt
box for generating a single illustration and dropping it into the
current frame's art window (same sizing as [Scryfall
import](#scryfall-import)'s art layer, via `resolveArtWindowMm`). It's
gated by `Entitlements.canGenerateAiArt` (see [Field
locking](#field-locking) for how entitlements generally work) — the
button is disabled with an upgrade-prompt tooltip when that's false.

This package never calls an image-generation API or holds a credential
of its own. Submitting the modal calls `aiArtBridge.ts`'s
`requestAiArt()`, which dispatches a bubbling, composed `ai-art-request`
CustomEvent (detail: `{ requestId, prompt }`, see [How this is meant to
connect to
moxproxies-website](#how-this-is-meant-to-connect-to-moxproxies-website))
and returns a Promise that the bridge resolves once the host page calls
`<card-studio-editor>`'s `.completeAiArtRequest(requestId, { src })` (or
`{ error }`) back. There's no timeout — a slow generation call is the
host's problem to bound, not this package's to guess a deadline for.

The actual generation happens entirely on the moxproxies-website side
(a separate repo): `StudioAiArtController::generate()` re-checks
`User::isPremium()` server-side (the client-side entitlement above is a
UI convenience only, never the real authorization boundary), renders
`resources/views/components/ai/prompts/card-art.blade.php` — which
prepends framing/style/no-text/no-frame instructions to the shopper's
raw prompt automatically, so nobody has to type "no card frame, just the
illustration, landscape" themselves — and calls OpenAI's `gpt-image-1`
at the fixed size configured in `config/card_studio.php`'s `ai_art`
block (`1536x1024`; that model only accepts three fixed sizes, no
arbitrary aspect ratio). The response comes back as a `data:` URI rather
than an uploaded/stored asset: it becomes the new layer's `src` exactly
like any other image layer, and there's no separate storage/CORS
question to solve since a `data:` URI needs no cross-origin fetch to
render on `<img crossOrigin="anonymous">` (`useHtmlImage.ts`) or to load
server-side for print export (`@napi-rs/canvas`'s `loadImage` accepts
`data:` URIs directly, same as any other source).

## Design decisions

**Clicking a transparent part of a layer selects whatever's underneath it,
not that layer.** Konva's default hit region for an `Image` shape is its
whole rectangle regardless of pixel alpha, so a frame's art window (real
transparency, by design — see [Adding frames](#adding-frames)) used to
be just as clickable as its painted border, making it easy to grab the
frame when you meant to grab the art or text underneath. Fixed with a
small hook, `useAlphaHitCache` (`apps/editor/src/hooks/`), that calls
Konva's built-in `cache()` + `drawHitFromCache()` on frame and image
layers — this rasterizes the node once and tells Konva's hit-testing to
treat fully-transparent cached pixels as "not hit," so the pointer event
falls through to the next node down, exactly as if the transparent layer
weren't there. One wrinkle: `drawHitFromCache` is a `Shape`-only method
(a `Group` draws nothing of its own to rasterize), so for an image layer
— rendered as a `Group` (for `clipFunc`) wrapping the actual
`<KonvaImage>` — the cache has to go on that inner shape specifically,
with the click still bubbling up to fire the `Group`'s own handler like
any other Konva event, since the drag/select/transform machinery has to
stay on the `Group` (the layer's full nominal box, unaffected by
`contain`-mode letterboxing). The cache is a snapshot, not live, so it's
redone whenever the loaded image or the layer's own size changes. Text
and shape layers don't get this treatment (yet) — text glyphs are sparse
too, but frames/images were the reported, concrete problem.

**Frame/image layers now default to full-bleed size, not cut/trim size —
and the built-in frame art had to be regenerated to match.** New frames
and newly uploaded/imported images used to size themselves to
`cutWidthMm`/`cutHeightMm`, deliberately, so they'd match the finished
card exactly. In practice this meant the bleed margin (the ~3mm strip
that gets trimmed away, there specifically so a slightly-off cut doesn't
reveal a sliver of unprinted background around the card) was never
covered by anything — confirmed by testing: a manually-resized layer
extending into the bleed rendered and exported completely fine, both
live and after export, so there was no clipping bug anywhere in the
pipeline; the *default* size was just never reaching that far in the
first place. Fixed by sizing new Frame/Image layers (`Toolbar.tsx`'s
`addFrame`/`addImage`, and the Scryfall art layer) to
`design.size.widthMm`/`heightMm` (bleed) instead of
`cutWidthMm`/`cutHeightMm`. Since the bleed margin is a uniform ~3.048mm
addition on every side rather than a proportional scale-up (see
`STANDARD_CARD_SIZE_MM` below), simply stretching the existing cut-sized
placeholder frame art into the bigger box would have distorted it
slightly (about a 2.6% aspect mismatch) — so
`generate-placeholder-frames.mjs` was rewritten to draw at true bleed
dimensions instead: the canvas is filled with the border color first (so
it reaches the true edge with no gap), then the whole existing
border/name-bar/type-bar/etc. layout is drawn offset by the same margin,
and finally the art window is punched back out to transparent with
`clearRect()` — that fill-first step would otherwise have painted over
it too, since the window's transparency previously came from just never
touching that region on a canvas that started transparent by default.
There's intentionally no separate visibility toggle for this — any
layer's own width/height already lets you resize it smaller (e.g. back
to fit only within the cut box) if you don't want it reaching the bleed
edge, so a global switch would just be a second way to do the same thing.

**An ImageLayer's `fit` field existed in the schema but neither renderer
actually implemented `contain`/`fill` — both silently always behaved
like `cover`.** Both `LayerNode.tsx`'s plain `<KonvaImage>` (stretched to
the layer's box, i.e. `fill`) and `renderDesign.ts`'s `drawImage`
(always scaled to the *larger* of the two axis ratios and clipped, i.e.
`cover`) ignored the field entirely — harmless at the time, since every
image layer's box happened to already be sized to the image's own
aspect ratio (`addImage` picked the box that way, back then — it no
longer does, see the full-bleed-import note above), but it would
silently distort anything placed in a box of a different aspect ratio,
which the rarity symbols are (a square-ish SVG dropped into a
hand-picked box). Fixed
with a shared `computeObjectFit` helper
(`packages/scene-schema/src/objectFit.ts`, the same CSS `object-fit`
math for all three modes) that both sides now call — `LayerNode.tsx`
wraps the image in a `Group` sized to the box (clipped only for `cover`)
with the inner `<KonvaImage>` sized/offset by the fit result;
`renderDesign.ts`'s `drawImage` does the equivalent with `ctx.clip()`.
Verified by rendering the same box in all three modes side by side —
`contain` centers the unscaled-aspect image inside the box, `cover`
scales up and clips, `fill` stretches — where before all three looked
identical.

**Scene JSON is DPI-independent (millimeters, not pixels).** A `Design`
is a background color plus an ordered list of `Layer`s (`frame`,
`image`, `text`, `shape`), each positioned in mm from the full-bleed
canvas's top-left corner. The editor draws that same JSON on a
screen-resolution Konva canvas (`EDITOR_DPI = 150`, see
`apps/editor/src/geometry.ts`); the render service draws the *same*
JSON at print resolution. Nothing is ever rasterized then scaled up —
that's what keeps the card crisp at 800 DPI (2176×2964px, the
full-bleed size) for actual print fulfillment, which is what this needs
to feed. See `packages/scene-schema/src/schema.ts` and
`services/render/src/renderDesign.ts`.

**Card size has three nested, centered regions — `CardSize` in
`packages/scene-schema/src/schema.ts`, standard values in
`STANDARD_CARD_SIZE_MM` (`units.ts`):**
- `widthMm`/`heightMm` — the **full-bleed canvas** (69.096×94.096mm).
  This is what `design.size` sizes the Stage/export to; art and frame
  layers should extend all the way to this edge, since a printer trims
  the sheet down from here.
- `cutWidthMm`/`cutHeightMm` — the **trim/cut size** (63×88mm exactly),
  centered within the full-bleed canvas. This is the actual finished
  card. Drawn as a red dashed guide whenever the bleed itself is showing
  (see below) — with the bleed hidden, the card's own edge already is
  the cut line, so the guide would just be a redundant straight overlay
  on top of a now-rounded edge.
- `safeWidthMm`/`safeHeightMm` — the **safe area** (57.92×83.174mm),
  centered within the cut size. Nothing critical (text, important art)
  should sit outside this, since cutting has some tolerance. Drawn as an
  orange dashed guide, toggle-able via the ruler icon in the toolbar
  (`showSafeArea` in the store — a view preference, not part of the
  design or undo history). Independent of the bleed-preview toggle below
  — still meaningful (and still shown) with the bleed hidden.

**Bleed-preview toggle (the scissors icon, `showBleed` in the store)**
hides the bleed margin and rounds the corners, so the canvas shows how
the card looks once trimmed and die-cut instead of a rectangle sitting
in its own bleed. Implemented in `CanvasStage.tsx`: the background
`Rect` shrinks from the full bleed box to the cut box and gets a
`cornerRadius` (Konva `Rect` supports that natively); a `Group`
wrapping the actual layer content gets a `clipFunc` drawing the same
rounded rect (`roundedRectPath`, the same moveTo/arcTo/closePath
technique `generate-placeholder-frames.mjs` uses), since a frame/image
layer sized to bleed would otherwise still poke out past the rounded
corners and straight cut edge underneath a merely-shrunk background.
The radius (`BLEED_MASK_CORNER_RADIUS_MM = 2.5`) is the standard "R3"
die-cut radius trading-card stock is trimmed to.

This is purely a canvas view preference (default on, i.e. bleed
showing — same `showSafeArea`-style state, not part of the design or
undo history) and never touches the design JSON, so it can't affect the
authoritative print-quality export (`services/render`, which renders
straight from that JSON and always produces the full sharp-cornered
bleed box a printer needs to trim from). If it's on when the toolbar's
client-side "Export (800 DPI)" button is clicked, the masked/rounded
look *does* carry into that PNG, same as any other on-screen state of
the card's actual content — which is expected, since that button is an
explicit `stage.toDataURL()` snapshot of the card as currently shown
(see its own doc comment: "good enough for previews/proofing", not the
print path). Editor-only overlays (cut-line, safe-area, snap guides,
marquee, Transformer selection handles) are a different story and never
carry into that export: `handleExport` looks them up in one
`stage.find(".cs-export-hide")` — every one of them shares that Konva
`name` — hides each with `.visible(false)`, forces a synchronous
`stage.draw()` (`toDataURL` composites from each layer's own
already-rendered canvas, not a fresh redraw, so a merely-*scheduled*
`batchDraw()` wouldn't be reflected in time), captures, then restores
both.

  The trim size is the plain, exact 63×88mm standard trading-card size;
  the bleed (3.048mm/side) and safe-area margins (2.54mm horizontal,
  2.413mm vertical — asymmetric between axes, that's in the source
  spec, not a bug) come from a real print vendor's spec and are kept as
  *absolute* margins around that trim size, not a percentage of it —
  that's how a vendor actually specifies bleed/safety requirements: a
  fixed physical buffer for cutting tolerance, independent of the
  card's own trim dimensions. Get this wrong and print jobs come back
  with content cut off or a border of unprinted white — it's worth
  reading `units.ts`'s comment before changing any of these numbers.

**Panel content overflowing its own container was a missing `width:
100%`, not a sizing problem.** The properties panel used to overflow
horizontally past its own edge regardless of how wide it was given,
because `.cs-input` had no explicit width — a `<input type="number">`
without one keeps its browser-intrinsic width, which is wider than a
narrow two-column grid cell, and a flex/grid item's default `min-width:
auto` lets it force the *container* wider to fit that content instead of
clipping it. Fixed by giving `.cs-input` `width: 100%; min-width: 0`
(`styles.css`) and `minWidth: 0` on the grid/flex containers in
`PropertiesPanel.tsx`/`LayerPanel.tsx` — the panels themselves also
resized wider by default (300px) as a second line of defense, but that
alone wouldn't have fixed it at any width.

**Pan/zoom: the Stage is a viewport, not the card, scaled.** The obvious
first approach — give the Stage the card's own scale/position and call it
zoom — doesn't work: a `<canvas>` element's rendering is clipped to its
own pixel dimensions regardless of any internal transform, so a
card-sized Stage would clip anything panned or zoomed beyond those fixed
bounds. That's the same class of bug as the earlier transform-handle
clipping issue, just triggered by zoom instead of an oversized layer.
The fix (`CanvasStage.tsx`) is the standard "camera" pattern: the Stage
is sized to its own container (tracked with a `ResizeObserver`, so it
tracks panel resizes and window resizes too) and never scaled; all card
content — background, layers, guides, Transformer, even the marquee
overlay — lives inside one `Group` that carries `x/y/scaleX/scaleY` for
pan/zoom. Since Konva node coordinates for children of a transformed
ancestor are unaffected by that ancestor's transform (only their
*rendered* position/size changes), every existing piece of layer-drag,
resize, and snap-guide math kept working unmodified — none of it was
written in screen-pixel terms to begin with.

Two things specifically needed to change for coordinates to still line
up: marquee-selection now reads pointer position via the content
`Group`'s `getRelativePointerPosition()` instead of the Stage's
`getPointerPosition()`, so the drag rect comes out already in the same
model space as layer bounding boxes regardless of current pan/zoom
(no manual inverse-transform math needed). And PNG export
(`export.ts`) has to divide its `pixelRatio` by the current zoom and
crop from `{panX, panY, widthPx*zoom, heightPx*zoom}` instead of a fixed
region — otherwise export resolution would silently depend on whatever
zoom level happened to be on screen when you clicked Export (zoomed out
50% would have halved the output resolution, since Konva scales up from
however many pixels are actually rendered on screen, not from the card's
native size).

**Frame catalog is directory-driven, not hand-edited.** `frame-library/`
at the repo root is the canonical source: one subfolder per category,
one image per frame —

```
frame-library/
  classic/
    classic-white.png
    classic-blue.png
    ...
```

`scripts/sync-frame-library.mjs` scans it and publishes the result to
both consumers: it copies every image into `apps/editor/public/frames/`
(served to the browser) and `services/render/assets/frames/` (loaded by
`@napi-rs/canvas`'s `loadImage` from disk), and writes a generated
catalog — `id` (`"<category>/<slug>"`), display `name`/`categoryLabel`
(humanized from the folder/file names), `category`, `fileName` — to
`apps/editor/src/frameCatalog.generated.json` and
`services/render/src/frameCatalog.generated.json`. Both `frameAssets.ts`
modules just import that JSON; nothing about adding a frame requires
touching TypeScript. `FrameLibraryModal.tsx` (the search/filter browser)
and `renderDesign.ts` both resolve `assetId` against it, falling back to
a flat-tint placeholder for an unresolved id (unknown, or a legacy
design predating this asset) — so a catalog change never breaks an
existing design.

This is still two copies of the same files (one per consumer's runtime
needs — a browser fetches by URL, Node reads from disk) plus a generated
JSON catalog per copy — a known simplification for a two-consumer
scaffold, worth consolidating into a real asset store once there's a
persistence layer, rather than a shared package that still just ships
static files twice. `frame-library/` and the generated JSON/images are
all committed, so nothing needs to run at deploy time — only when you
actually add a frame.

The 6 built-in frames — a border, name bar, type bar, text box, and PT
box around a deliberately transparent "art window" (so an Image layer
placed underneath a Frame layer shows through as the card's art) — are
original, generic artwork (not a reproduction of any specific card
game's copyrighted frame design), generated with `@napi-rs/canvas` via
`services/render/scripts/generate-placeholder-frames.mjs`.

The frame-picker thumbnails and the editor's own frame rendering both
assume `/frames/...` is served from the deploying host's origin root; if
either build ever ships under a subpath, that'll need a proper base-path
fix (Vite's `base` config), not just changing the string.

**Embedding into moxproxies-website: a custom element, not an iframe.**
`apps/editor` has two Vite build targets:
- `dist/app` — the standalone SPA (deploy to e.g. `studio.moxproxies.com`
  for direct, full-page use).
- `dist/embed/card-studio-embed.js` — a self-contained bundle that
  registers `<card-studio-editor>` (`apps/editor/src/embed.ts`). The
  Laravel site loads it with a plain `<script type="module">` tag and
  drops the element into a Blade view:

  ```html
  <script type="module" src="https://studio.moxproxies.com/embed/card-studio-embed.js"></script>
  <card-studio-editor initial-design='{"...": "..."}' height="700px"></card-studio-editor>
  ```

  The element dispatches a `design-change` CustomEvent (detail = current
  `Design` JSON) on every edit, and exposes `.getDesign()` for reading
  the design imperatively (e.g. right before checkout). This was chosen
  over an iframe because moxproxies-website is a server-rendered
  Laravel/Blade app — a web component slots into an existing page the
  same way any other JS widget would, with no cross-origin postMessage
  plumbing needed for the common case of "mount an editor, read the
  result." It costs a slightly more coupled deploy (the host page needs
  the bundle's URL); that's an acceptable trade here since both sites
  are ours.

  It also dispatches `fullscreen-change` (detail: `{ fullscreen: boolean
  }`) whenever the toolbar's lightbox toggle fires — see App.tsx's own
  doc comment on why this exists: the lightbox's own extremely high
  z-index only wins *within* whatever stacking context the host wraps
  this element in, so a host with, say, a sticky top nav in a sibling
  stacking context with its own z-index can still end up drawing that
  nav on top of the lightbox regardless. moxproxies-website's own
  `resources/js/card-studio-editor.js` listens for this and temporarily
  lowers `#navbar`'s z-index for exactly as long as `detail.fullscreen`
  is true.

  It also dispatches `ai-art-request` (detail: `{ requestId: string,
  prompt: string }`) when the toolbar's "AI Art" modal is submitted (see
  [AI art generation](#ai-art-generation) and `aiArtBridge.ts`). This
  element never calls an image-generation API itself — the host page
  listens for the event, calls its own backend, and calls
  `.completeAiArtRequest(requestId, { src })` (or `{ error }` on
  failure) back on this element once it has a result, which resolves (or
  rejects) the modal's pending request and — on success — inserts the
  image as a new layer sized to the current frame's art window.
  moxproxies-website's `resources/js/card-studio-editor.js` is the
  reference implementation of that listener. Whether the modal can even
  be opened is gated client-side by `Entitlements.canGenerateAiArt` (the
  `can-generate-ai-art` attribute / `.setEntitlements()`, same wiring as
  `canEditLockedContent` above) — that's a UI convenience only, not an
  authorization boundary, since the host's backend re-checks the
  account's premium status server-side regardless of what this element
  was told.

  Several pitfalls specific to this shadow-DOM/library-mode build, all
  found by actually loading the built bundle in a plain host page rather
  than trusting the standalone dev server:
  - CSS custom properties are defined on `.cs-root`, not `:root` —
    `:root` only ever matches the top-level *document's* root element,
    never a shadow tree's boundary, so a stylesheet injected into the
    shadow root (see `embed.ts`) would silently fail to theme anything
    if it used `:root`. `styles.css` is imported with Vite's `?inline`
    query and manually appended as a `<style>` inside the shadow root
    for exactly this reason — a normal `import "./styles.css"` injects
    into `document.head`, which can't cross the shadow boundary either.
  - `vite.embed.config.ts` sets `define: { "process.env.NODE_ENV":
    '"production"' }` explicitly. Vite's standard app build replaces
    that automatically (React's CJS wrapper branches on it); library
    mode doesn't pick it up the same way, so without it the bundle
    throws `process is not defined` the instant it runs in a browser —
    which is, unhelpfully, exactly the environment it's loaded into.
    Fixing it also let Rollup dead-code-eliminate React's whole dev-mode
    branch, dropping the bundle from ~1.6MB to ~750KB.
  - Every frame/font/rarity/symbol asset URL was hardcoded root-absolute
    (`/frames/...`, `/fonts/...`, `/rarity/...`, `/symbols/...` —
    `frameAssets.ts`, `rarityAssets.ts`, `symbolAssets.ts`,
    `fonts.generated.css`), correct only when this app is served from its
    own domain root. The standalone build always is; the embed isn't —
    moxproxies-website serves `card-studio-embed.js` from its own
    `public/vendor/card-studio/`, not the domain root — so every one of
    those requests 404'd there: frames and rarity/mana symbols silently
    failed to render, and every embedded font fell back to the browser
    default. Fixed with `assetBase.ts`'s `ASSET_BASE` (default `"/"`,
    unchanged for the standalone build) — `embed.ts` sets it once, at
    module load, from `import.meta.url`'s own containing directory
    (portable regardless of what subpath a host serves the script from,
    since the `fonts/`/`frames/`/`rarity/`/`symbols/` directories are
    always copied as true siblings of `card-studio-embed.js` — see
    `vite.embed.config.ts`), and rewrites `fonts.generated.css`'s
    `/fonts/` references directly (plain generated CSS text can't read a
    JS variable). Two call sites — `FrameLibraryModal.tsx`'s and
    `PropertiesPanel.tsx`'s frame thumbnail `<img>`s — had their own
    inline `` `/frames/${category}/${fileName}` `` construction instead
    of going through `getFrameAssetUrl`, so they needed the same fix
    applied by hand; every other asset reference in the app already went
    through the three `getXAssetUrl` helpers this ASSET_BASE change
    covers automatically. Verified by building the embed bundle and
    serving it from a nested path (`/vendor/card-studio/`, matching
    moxproxies-website's actual layout) rather than a bare directory
    root — the standalone dev server alone can't catch this class of
    bug, since it always happens to serve from its own root.
  - Every `window`-level listener that inspected `e.target` broke inside
    the embed specifically: a listener attached *outside* a shadow
    boundary sees `e.target` retargeted to the shadow host
    (`<card-studio-editor>` itself) for any event that originated
    *inside* it, never the actual inner element — a standard, easy-to-
    forget part of the shadow DOM spec. Two real bugs from this, both
    only reproducible inside the embed (never the standalone app, which
    has no shadow root to retarget across): `TextTemplateMenu.tsx`'s
    click-outside-to-close handler treated *every* click inside the
    menu, including on "Add all fields" itself, as "outside" and closed
    the menu on `mousedown` — before the `click` that would've fired
    `onAdd`/`onAddAll` ever got a chance to run, so every field-add
    button silently did nothing. `isTypingTarget.ts` (backing both
    `useKeyboardShortcuts.ts` and `CanvasStage.tsx`'s space-to-pan) never
    recognized an INPUT/TEXTAREA as a typing target, so global shortcuts
    fired *while typing* — Delete deleting the selected layer instead of
    a character, Ctrl+Z undoing instead of the browser's own undo. Fixed
    by reading `e.composedPath()[0]` instead of `e.target` in both —
    `composedPath()` returns the real innermost target regardless of
    shadow boundaries, exactly the case `e.target`'s retargeting exists
    to prevent leaking to outside listeners. `isTypingTarget` now takes
    the whole event instead of a bare target for this reason. Every
    other `window`-level listener in the app was audited against this
    same question (does it read `e.target`, and does that determination
    need to be *correct*, not just non-throwing) — the rest either don't
    inspect the target at all (`ResizeHandle.tsx`'s drag, every modal's
    Escape-to-close) or are safe for an unrelated reason (a backdrop's
    own `onMouseDown` via JSX, which React delivers correctly since both
    the listener and the target live inside the same shadow tree —
    retargeting only bites listeners *outside* the boundary).

**A `fit: "cover"` image's selection handles used to balloon out past the
card's edges whenever the source image's aspect ratio was far from its
box's** — most visibly on a Scryfall art crop (a landscape illustration)
placed into the classic frame's illustration window (`frameArtWindow.ts`,
close to square), the exact combination [Scryfall
import](#scryfall-import) produces. `LayerNode.tsx` used to render
`"cover"` by drawing the source image at its full scaled-up size (bigger
than the box in whichever dimension overhangs) and hiding the overflow
with a `clipFunc` on the wrapping `Group`. That clips what's *painted*
correctly, but Konva's `Container.getClientRect()` (which `CanvasStage`'s
Transformer calls to size the selection handles) sums its children's
*unclipped* rects — it has no concept of `clipFunc`/`clip` at all (see
`konva/lib/Container.js`) — so the reported bounding box was as big as
the oversized, unclipped image, not the layer's actual box, and the
Transformer's handles stretched out to match. Fixed by cropping the
*source* image instead, via `Konva.Image`'s own `crop` prop (computed
from the same `computeObjectFit` result `objectFit.ts` already produced,
just converted from destination-space offset/draw-size back into
source-space crop coordinates) — the on-stage image element's width/
height already equal the box exactly, so there's nothing left to clip
and nothing oversized for `getClientRect()` to pick up. `services/render`
(a real 2D canvas context, not Konva) never had this problem — `ctx.clip()`
there restricts actual pixels, not just a separately-tracked bounding box.

**Layer content wasn't clipped to the full-bleed edge at all with the
bleed guide showing (the default) — only the narrower cut box, and only
once the bleed was toggled off.** `CanvasStage.tsx`'s layer-content
`Group` had a `clipFunc` that only ever activated for the "preview
trimmed card" mode (`!showBleed`); with the bleed shown there was no
clip whatsoever, so an oversized or misplaced layer (most commonly an
imported image, or a layer dragged/resized past the edge) painted
straight into the workspace background outside the card — never a
preview of anything real, since nothing past the full-bleed edge ever
makes it into the exported image either way. Fixed by always clipping to
*some* card-shaped boundary: the sharp-cornered full-bleed rect when the
bleed guide is showing, the same rounded cut box as before once it's
hidden. This is a hard clip, not a toggle — there's no legitimate design
reason to want to see content past the actual printable edge — but it
doesn't affect editing: the Transformer's selection handles live in a
separate, unclipped group, so an overhanging layer is still fully
visible-by-its-handles and draggable/resizable, only its painted pixels
are held to the boundary.

**Local image uploads (`addImage`, `Toolbar.tsx`) now read the file as a
`data:` URI instead of `URL.createObjectURL`'s `blob:` URL.** A `blob:`
URL is only a live reference into the current tab's memory — nothing
keeps the underlying `File`/`Blob` around past that, so a design saved
with one looked fine right up until the next reload, at which point that
layer's image silently vanished, and `services/render`'s server-side
print export (a separate process entirely) could never have loaded it to
begin with. Neither problem exists for AI-generated art (`AiArtModal.tsx`
already returns a `data:` URI) or Scryfall import (a real, always-
reachable `https://` URL) — this was specifically an "Add Image" gap.
`FileReader.readAsDataURL` costs some size (the encoded image lives
directly in the saved design JSON rather than as a separate asset), an
accepted tradeoff here for the same reason AI art's `data:` URI was: no
S3/CORS story to solve for either origin otherwise.

## How this is meant to connect to moxproxies-website

**No API key, and the embed itself needs no auth at all.** `card-studio-embed.js`
is a static, self-contained bundle (see "Building the embed bundle" above) —
moxproxies-website builds it same-origin (its own Vite pipeline copies/serves
the file) and drops a `<card-studio-editor>` element into a normal
session-authenticated Blade/Livewire page, the same as any other page asset.
There's nothing secret inside it to protect with a key, and a browser-embedded
key can't be secret anyway. The widget's whole surface is `initial-design`,
`can-edit-locked-content`, `.getDesign()`, `.setEntitlements()`, and the
`design-change` event (see `embed.ts`) — it never makes a network call of its
own. **The one earlier idea in this section that turned out unnecessary:
passing a short-lived token *into* the widget.** It isn't needed — the host
page itself is already an authenticated moxproxies-website page with its own
session/CSRF token, so it's the host page's own JS (not the widget) that
calls back to moxproxies-website's own endpoints on save/publish/buy, using
whatever auth it already has. The widget stays completely tokenless.

The actual pipeline, as it's meant to be built on the moxproxies-website side
(nothing here yet — see [Not built yet](#not-built-yet) — this documents the
target shape so both sides agree on the contract):

- moxproxies-website already has a `CardDesign` model
  (`app/Models/CardDesign.php`) driving a *prompt/field-based* AI-art card
  pipeline (`GenerateCardImageForCardDesign` job) — flat MTG columns
  (`name`, `mana_cost`, `rules_text`, `rarity`, ...), no scene JSON. Card
  Studio is a different, visual-editor path to producing a card image; the
  two coexist on the same model rather than replacing it. A `CardDesign` row
  gains a JSON column (e.g. `studio_design`) holding the raw `Design` this
  app produces, so a design can be reopened for further editing later, and
  the existing (currently-unpopulated) `generated_url` column is what a
  render of it fills in.
- The host page's JS calls `getDesign()` and `POST`s the raw `Design` JSON
  (plus a `visibility`/`card_design_id` if editing an existing one) to a
  moxproxies-website endpoint, using the page's own session/CSRF — no
  metadata object needs to be assembled separately. `TextLayer.fieldId` (the
  `text-template-library/` field id — `"title"`, `"rules"`, `"artist"`,
  etc. — see schema.ts) is what lets that endpoint reliably map layers back
  onto `CardDesign`'s flat columns for search/display, instead of guessing
  from a layer's free-text `name`. Rarity and frame category are already
  unambiguous either way — `RARITY_LAYER_ID`'s `assetId` and the Frame
  layer's `assetId`/category are stable catalog ids, not guesses.
- That endpoint creates/updates the `CardDesign` row, then dispatches a
  queued job (mirroring `GenerateCardImageForCardDesign`'s own
  `generation_status: queued → processing → completed/failed` pattern) that
  calls `services/render`'s `POST /render` **server-to-server** — Laravel to
  this service directly, never the browser — and stores the resulting PNG.
  `services/render` accepts an optional shared secret for exactly this call
  (`RENDER_SHARED_SECRET` env var + an `X-Render-Secret` header — see
  `server.ts`); unset by default for local dev, since this is meant to run
  on a private network/localhost relative to the Laravel app ("host it on
  the same server"), not be publicly reachable at all. Buying a card is the
  same flow, plus mapping the resulting `CardDesign` onto a cart line —
  still an open product decision on the moxproxies-website side (what SKU a
  custom design attaches to), not something this repo has an opinion on.
- `sourceCardDesignId` already exists on `Design` (see schema) as the join
  point back to a `CardDesign` row, for the reverse direction (loading an
  existing design back into the editor).
- The one piece of premium/entitlement plumbing that *does* exist today is
  `Entitlements.canEditLockedContent` (see [Field locking](#field-locking))
  — a plain boolean the host page passes down via the
  `can-edit-locked-content` attribute or `.setEntitlements()`. When a real
  premium check exists on moxproxies-website, computing that boolean from
  the logged-in user's subscription and passing it in is the entire
  integration; nothing on the Card Studio side needs to change.

### Deploying a local build to moxproxies-website

There's no CI/CD for this — moxproxies-website's `public/vendor/card-studio/`
is just a committed copy of `apps/editor/dist/embed/`'s output (see
"Building the embed bundle" above), redeployed by hand each time: build,
copy the whole `dist/embed/` folder over (not just the `.js` file — the
`fonts/`/`frames/`/`rarity/`/`symbols/` sibling directories have to come
with it), stamp `SOURCE_COMMIT` with the commit this build came from, commit
on the moxproxies-website side.

`scripts/deploy-to-moxproxies.sh` does the copy/stamp/commit half of that,
given an already-built `dist/embed` dir, the target website checkout, and a
commit hash:

```bash
pnpm run build   # in apps/editor
scripts/deploy-to-moxproxies.sh apps/editor/dist/embed /path/to/moxproxies-website "$(git rev-parse HEAD)" [--push]
```

For a Windows checkout of this repo with moxproxies-website living under
WSL (a Laravel app, so it typically runs there even when card-studio itself
is native Windows) — `scripts/deploy-to-moxproxies.ps1` is a one-command
wrapper: it builds on the Windows side (where this checkout's `node_modules`
actually are), then calls the bash script above from WSL for the copy/
commit half, so that runs natively against the website's own filesystem
instead of over the slower/quirkier `\\wsl.localhost\...` UNC path.

```powershell
pnpm run deploy:moxproxies             # commits, doesn't push
pnpm run deploy:moxproxies -- -Push    # also pushes
```

Both scripts default to the paths/distro this was first set up against
(`WebsiteDir`/`WslDistro` params on the `.ps1`, first three positional args
on the `.sh`) — override either if your layout differs.

## Tests

478 end-to-end checks in `tests/e2e/` — curl against a running backend,
Playwright against the running editor. That's the default here: every bug
that actually shipped was one reading the diff missed and running the app
caught.

The exception is `backend/tests/Feature/` (37 PHPUnit tests), for the
handful of things a live run can't honestly prove — an OAuth provider
lying about a verified email, an email actually being queued, or a token
expiring thirty days from now.

```sh
pnpm test:e2e            # boots its own backend + editor, runs everything
pnpm test:e2e:api        # curl suites only
pnpm test:e2e:browser    # Playwright suites only
```

The runner uses its own ports and a throwaway database rather than
whatever `pnpm dev:editor` left running — see
[`tests/e2e/README.md`](tests/e2e/README.md) for why, and for the two
assertion rules worth knowing before adding more.

CI (`.github/workflows/ci.yml`) runs typecheck + build, PHPUnit, and the
full e2e suite as three jobs on every PR.

## Not built yet

- In-app frame/font/rarity-symbol/text-template upload (adding any of
  these is a file-drop + `pnpm sync-*` + commit workflow today — see
  [Adding frames](#adding-frames) / [Adding fonts](#adding-fonts) /
  [Adding/changing rarity symbols](#addingchanging-rarity-symbols) — not
  a button in the UI; there's also no way yet for a running deployment
  to pick up a new one without a rebuild/redeploy)
- Real (database-backed) persistence now exists for signed-in accounts
  (see [Save/load](#saveload) and [Backend (API)](#backend-api)) — a
  design saved while signed in syncs to `backend/`'s `card_designs` table
  and follows the account across devices/browsers. Anonymous use is
  unchanged: still `localStorage` only, per-browser, nothing synced.
  Panel widths and the safe-area/bleed-preview toggles are still pure
  in-memory view state either way (not part of a saved design) and reset
  on reload regardless.
- The moxproxies-website side of the integration described in [How this is
  meant to connect](#how-this-is-meant-to-connect-to-moxproxies-website) —
  the `studio_design` column, the submission endpoint, the render-triggering
  job, and the actual embed page — none of that lives in this repo, so
  none of it exists yet from Card Studio's side either.
- Template authoring beyond the lock flags — see [Community
  templates](#community-templates)'s "Deferred".
- Deploy config for either app (including actually running
  `services/render` somewhere reachable from moxproxies-website's backend)
