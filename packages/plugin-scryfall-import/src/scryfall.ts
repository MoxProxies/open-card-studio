/**
 * Thin client for Scryfall's public card API (https://scryfall.com/docs/api)
 * — CORS-enabled for direct browser use, no API key. Two calls: a cheap
 * autocomplete for the search box's live suggestions, then a full card
 * fetch once the user picks a name — see SearchModal.tsx.
 *
 * This is the only file in this package that talks to Scryfall
 * specifically; everything else (SearchModal.tsx, index.ts) only knows
 * about the CardFields shape below and the generic plugin contract from
 * @card-studio/plugin-sdk. A different data-source plugin (a different
 * game's API, a local card database, a CSV file) replaces just this file
 * and toCardFields()'s mapping — the rest of the plugin is reusable.
 */

const API_BASE = "https://api.scryfall.com";

export interface ScryfallCardFace {
  name: string;
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
  power?: string;
  toughness?: string;
  image_uris?: { art_crop?: string; normal?: string; [key: string]: string | undefined };
}

export interface ScryfallCard extends ScryfallCardFace {
  flavor_text?: string;
  artist?: string;
  rarity?: string;
  card_faces?: ScryfallCardFace[];
}

export async function autocompleteCardNames(query: string): Promise<string[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const res = await fetch(`${API_BASE}/cards/autocomplete?q=${encodeURIComponent(trimmed)}`);
  if (!res.ok) throw new Error(`Scryfall autocomplete failed (${res.status})`);
  const data = (await res.json()) as { data?: string[] };
  return data.data ?? [];
}

export async function fetchCardByName(name: string): Promise<ScryfallCard> {
  const res = await fetch(`${API_BASE}/cards/named?exact=${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error(`Scryfall lookup failed for "${name}" (${res.status})`);
  return (await res.json()) as ScryfallCard;
}

export interface CardFields {
  name: string;
  manaCost: string;
  typeLine: string;
  oracleText: string;
  flavorText: string;
  powerToughness: string;
  artist: string;
  rarity: string;
  artCropUrl?: string;
}

/**
 * Flattens a card into the fields index.ts maps onto GeneratedCardFields.
 * Double-faced cards (transform, MDFC, ...) carry most fields on
 * card_faces[0] instead of the top level — this only ever looks at the
 * front face; picking a specific face isn't supported yet.
 */
export function primaryCardFields(card: ScryfallCard): CardFields {
  const front = card.card_faces?.[0];
  const power = card.power ?? front?.power;
  const toughness = card.toughness ?? front?.toughness;
  return {
    name: card.name,
    manaCost: card.mana_cost || front?.mana_cost || "",
    typeLine: card.type_line || front?.type_line || "",
    oracleText: card.oracle_text || front?.oracle_text || "",
    flavorText: card.flavor_text || "",
    powerToughness: power && toughness ? `${power}/${toughness}` : "",
    artist: card.artist || "",
    rarity: card.rarity || "",
    artCropUrl: card.image_uris?.art_crop || front?.image_uris?.art_crop,
  };
}
