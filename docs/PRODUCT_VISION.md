# Product vision & roadmap

`README.md` documents how the code works. This document says what
open-card-studio is being built *toward* as a product, and in what order
to build it. **Read this before starting any of the phases below in a
fresh session** — it's context a from-scratch session has no other way
to pick up, and starting one of these phases without it risks redoing
architecture decisions that were already made here.

## The pitch

open-card-studio is a standalone, sellable, account-based card design
product — web first, mobile-portable later. It is not MTG-proxy tooling
like moxproxies-website (the codebase this repo was forked from), and it
must not read like it. Any franchise-specific behavior (Scryfall import,
mana symbols, the default frame/rarity art) is a *plugin* — opt-in,
swappable, never load-bearing for the core product. That separation is
already real (see `README.md`'s Plugin system section); everything below
builds on top of it, not around it.

Users will:
- sign in and build cards with a generic, template-driven designer
- save/organize cards into collections
- browse and contribute to a community knowledge base (how to print/cut/
  source card stock at home, design tips, etc.)
- earn points and levels from engagement (likes/upvotes on their designs,
  collections, and posts), which unlock cosmetic profile perks (featured
  designs, badges like "Community Contributor" or "Pillar")

The designer stays the center of gravity. Collections, the knowledge
base, and gamification exist to give people a reason to keep making and
sharing things in it — they are not separate products bolted on the side.

## Non-negotiable constraints (liability)

- **No first-party template ships pretending to be a licensed property.**
  "MTG-style," "Pokémon-style," "Lorcana-style" — these exist only as
  community-authored templates, clearly attributed to the community
  member who made them, never presented as official or as coming from
  open-card-studio itself. The plugin system's whole reason for existing
  (see `README.md`) is this same principle applied to import sources and
  asset packs; templates are the same principle applied to layout.
- **Every piece of user content needs an owner, a visibility state, and a
  moderation/report path from the schema it's born with.** Retrofitting
  moderation after a public community feature has shipped is much harder
  than building the columns in on day one. This applies to designs,
  templates, collections, and knowledge-base posts alike.
- **This document can plan the architecture that supports a Terms of
  Service, a DMCA agent/takedown flow, and a user-content license — it
  cannot write the legal text itself.** That needs a human, ideally a
  lawyer. A future session's job is to leave the right hooks (report
  reasons, moderation states, audit trail, data export/deletion for
  account closure) in place so that when the legal text exists, there's
  somewhere for it to plug in — not to draft policy.

## The architectural centerpiece: templates reuse the existing lock model

This is the single most important design decision in this document,
because it changes "generic template engine" from a big new subsystem
into a moderately-sized addition to what already exists.

`packages/scene-schema` already gives every layer two independent
booleans: `locked` (can't move/resize/restyle) and `contentLocked`
(can't edit the actual text/image content) — see `README.md`'s
[Field locking](../README.md#field-locking) section. That's *already*
the exact vocabulary a template needs:

- A template's decorative chrome (frame art, rarity symbol, background)
  is `locked: true, contentLocked: true` — nobody filling in the
  template should be able to move or replace it.
- A template's fill-in slots (name, rules text, art) are
  `locked: true` (position/size/font stays as the template author set
  it) but `contentLocked: false` (the *value* is exactly what a user
  is supposed to change).
- A template author building the layout in the first place just uses
  the editor exactly as it exists today, then locks the layers they
  want fixed before publishing — no new placement UI needed for v1.

So a `Template` is not a new kind of schema — **it's a `Design` (same
`packages/scene-schema` shape) plus publishing metadata**: id, owner,
name, description, category tags (free-text or a small curated list —
not a hardcoded enum of franchises, see the liability section above),
visibility (`private` / `unlisted` / `published`), a usage/fork count,
and a version number if templates need to evolve without breaking cards
already made from them. "New card from template" is: clone the
template's layer array into a fresh `Design` with a new id, leave the
lock flags exactly as authored, done. This is most of Phase 1's backend
work; the editor changes are mostly UI (save-as-template, browse/search,
apply) rather than schema work.

**Keep this separate from the existing file-based asset workflow.** The
`text-template-library/`, `frame-library/`, `font-library/`,
`rarity-library/`, `symbol-library/` directories plus their `pnpm
sync-*` scripts (see `README.md`'s "Adding frames"/"Adding fonts"/etc.
sections) are how the *built-in* `plugin-asset-pack-default` package
ships its first-party art and default text-field configs — a
build-time, committed-to-git, redeploy-to-update mechanism. Community
templates are database rows created through the app at runtime by
users, not files synced into this repo. Don't conflate the two systems
or try to unify them — they solve different problems (shipping curated
first-party assets vs. letting any signed-in user publish a layout).

## Phased roadmap

Each phase is meant to be handed to a fresh Claude Code session as its
own scoped unit of work — see the end of this document for suggested
session-starter prompts. Don't try to do more than one phase per
session; the existing engineering culture in this repo (see `README.md`)
is to verify each change against a real running app before moving on,
and that gets harder to do honestly the more is in flight at once.

### Phase 0 — Decisions before code

A few choices ripple into everything after them and are cheap to make
explicitly now, expensive to unwind later:

- **Mobile strategy.** Recommendation: don't fork into a second
  (React Native) frontend. `apps/editor` is already React + Vite, the
  API is already token-auth (mobile-friendly by construction — no
  cookie/CSRF session to translate), and Konva already handles touch
  events. Make the existing web app genuinely responsive/touch-friendly
  (this is most of Phase 5 below), then wrap it for app-store
  distribution later with something like Capacitor when that's actually
  needed. One codebase, one design system, one place bugs get fixed.
  This is a recommendation, not a mandate — revisit if there's a reason
  native APIs (camera, share sheet, etc.) become central to the product.
- **Moderation staffing.** Points/levels/badges/publishing are only as
  safe as the reporting and moderation tooling behind them. Decide
  before Phase 4 whether moderation is "the founders review a queue" or
  something more automated — it changes how much tooling Phase 4 needs
  to build vs. defer.
- **Points formula.** Don't over-design this. A simple, tunable
  point-per-event table (see Phase 4) beats a clever formula nobody can
  explain to a user who asks "why did I level up."

### Phase 1 — Generic template engine

> **Shipped** — see the root README's [Community
> templates](../README.md#community-templates). The three out-of-scope
> items below stayed out of scope. One thing this didn't anticipate:
> `contentLocked` had no UI at all, so an author couldn't mark a layer as
> chrome; the properties panel now has a toggle for it.

The designer's core value proposition, and the reason the "reduction in
liability" goal and the "not just MTG" goal are actually the same
requirement wearing two hats. Scope:

- Backend: `Template` model/migration (owner, name, description, tags,
  visibility, `design` JSON blob, usage count, version), CRUD + publish
  endpoints, scoped/visibility-aware listing (a browse/search endpoint
  for published templates, separate from "my templates").
- Frontend: "Save as template" from the existing editor (author locks
  the layers they want fixed, names it, publishes or keeps it private),
  a template browser/picker, "start a new design from this template"
  (clones layers into a new `Design`, same pattern `designStorage.ts`
  already uses for save/load — see `README.md`'s Save/load section).
- Explicitly out of scope for v1: a visual "define this region as a
  slot with these constraints" authoring mode beyond the lock flags
  above, template versioning/migration of already-made cards when a
  template changes, template forking/remixing lineage. Note these as
  future work rather than building them speculatively.

### Phase 2 — Accounts & public profiles

> **Shipped** — see the root README's [Accounts &
> profiles](../README.md#accounts--profiles). Usernames, bios, avatar
> URLs, public profiles, one shared visibility vocabulary across designs
> and templates, and the polymorphic report table. Avatars are a URL
> field, not an upload — this backend has no file storage yet.

Extends the Sanctum auth already built (`backend/app/Http/Controllers/
Api/AuthController.php`) rather than replacing it: username, avatar,
bio, a public profile page listing a user's published designs/templates/
collections. This is also where the visibility/ownership/report
groundwork from the constraints section above needs to actually land in
the schema for every content type that's about to become public.

### Phase 3 — Collections

> **Shipped** — see the root README's
> [Collections](../README.md#collections). It did what it was meant to
> as a test of the earlier phases: the model is two concerns and an
> abstract controller, and the only genuinely new code is the membership
> pivot and the rule that a public collection hides (and doesn't count)
> its owner's private designs.

Grouping owned designs (think: a binder or a deck) — ownership scoping,
visibility, and a collection detail page follow the same pattern
`card_designs` already established. Should be a relatively small phase;
mostly validates that the Phase 1/2 patterns (ownership, visibility,
moderation state) generalize cleanly before Phase 5 asks them to
generalize twice more (posts, gamification).

### Phase 4 — Gamification core

> **Shipped** — see the root README's [Points, levels &
> badges](../README.md#points-levels--badges). All five pieces exist:
> polymorphic reactions, the append-only ledger, a thresholds table,
> rule-based *and* manual badges, and level-gated featuring. **The
> numbers in `backend/config/gamification.php` are placeholders** — they
> are still the open decision this document lists for a human, and
> nothing else hardcodes them. Two behaviours worth a decision if you
> disagree: awards are never reversed when someone un-reacts, and manual
> badge granting has no endpoint (no staff role exists yet to authorise
> one — a founder grants from tinker).

Build this as one generic system, not four bespoke ones:

- A **polymorphic reaction/like** table (reactable type + id) usable
  against designs, templates, collections, and knowledge-base posts —
  one endpoint, one UI component, four content types.
- An **event-sourced points ledger** (append-only `PointEvent` rows with
  a reason/source and amount, not a mutable integer column) — mirrors
  the pattern moxproxies-website already uses for AI credits, for the
  same reason: an auditable history beats a number you have to trust.
- **Levels** as a pure function of cumulative points (a small thresholds
  table, not hardcoded math) — keep it boring and explainable.
- **Badges** as their own awardable entity, supporting both rule-based
  grants (e.g., "N accepted knowledge-base posts") and manual grants
  (e.g., "Pillar" awarded by a founder) — model both from the start
  rather than assuming every badge is automatable.
- **Featured designs**: a per-profile flag a user can set on their own
  content once their level clears a threshold, surfaced on the public
  profile from Phase 2.

### Phase 5 — Community & knowledge base

> **Shipped** — see the root README's [Knowledge
> base](../README.md#knowledge-base). Posts, categories, tags, edit
> history and comments, reusing the Phase 4 reactions and the Phase 2
> report/visibility groundwork exactly as planned — a post is another
> `OwnedByUser + Publishable + Reactable` model. Markdown renders to
> React elements rather than HTML, so there is no sanitizer to get wrong.
> Comments are polymorphic but only exposed on posts; attaching them to a
> design is a product decision nobody has made.

### Phase 6 — Mobile-first UI pass & trust/safety hardening

> **Partly done early.** The app is now an app: five destinations with a
> bottom tab bar on phones and a top nav on wider screens, deep-linked in
> the URL — see the root README's [App
> shell](../README.md#app-shell-standalone-app). What's left of this
> phase for the UI is the *editor's* own layout on a phone (the
> three-pane canvas/layers/properties split), plus the moderation tooling
> below.

A dedicated pass rather than something assumed to have happened
incidentally: touch-target sizing, the editor's pan/zoom/toolbar layout
on small screens, and a real device/viewport testing pass. Pair it with
hardening the moderation tooling that's been accumulating hooks since
Phase 1 — a working report queue, content takedown, and account
suspension flow, since this is roughly the point a public launch becomes
plausible.

## Open decisions for a human, not a session

- Final mobile strategy (Phase 0 gives a recommendation, not a decision)
- Who moderates, and with what tooling budget
- The actual points-per-action numbers
- Terms of Service / user content license / DMCA agent text
