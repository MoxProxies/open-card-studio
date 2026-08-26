/**
 * Re-exported for backwards compatibility with existing imports
 * (`../generatedCardFields`) elsewhere in this app — the canonical
 * definition now lives in @card-studio/plugin-sdk, since it's the
 * contract type between core and any ImportSourcePlugin, not something
 * specific to this app. See that package's src/types.ts for the actual
 * shape and its doc comment.
 */
export type { GeneratedCardFields } from "@card-studio/plugin-sdk";
