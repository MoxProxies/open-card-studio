import { Design } from "@card-studio/scene-schema";
import type { Visibility } from "./visibility";

export interface DesignSummary {
  id: string;
  name: string;
  updatedAt: string;
  /** Set only by the account-backed implementation — a localStorage design
   * lives in one browser and has nothing to be visible *to*. */
  visibility?: Visibility;
}

/**
 * Where saved designs live — deliberately small, swappable, and async
 * (a real backend can never be sync the way localStorage is, so the
 * interface is shaped for that from the start rather than assuming
 * otherwise). `localStorageDesignStorage` below and `apiDesignStorage`
 * (api/apiDesignStorage.ts, backed by backend/'s `card_designs` API —
 * see root README's "Backend (API)") both satisfy it; every consumer
 * (DesignLibraryModal.tsx) only ever talks to the `designStorage`
 * binding at the bottom of this file, never to a specific
 * implementation directly, so which one is actually active can change
 * at runtime (AccountButton.tsx calls setActiveDesignStorage() on
 * sign-in/sign-out) without any consumer changing. `Design.parse()` on
 * load is what makes a save from an older version of this app (missing
 * a field a newer schema added) still load cleanly either way — same
 * defaulting behavior the embed's `initial-design` attribute and the
 * render service's request body already rely on.
 */
export interface DesignStorage {
  list(): Promise<DesignSummary[]>;
  load(id: string): Promise<Design | undefined>;
  /** Upserts by `design.id` — saving a design twice updates the same
   * record rather than creating a second one. */
  save(design: Design): Promise<DesignSummary>;
  remove(id: string): Promise<void>;
}

const STORAGE_KEY = "card-studio:designs:v1";

interface StoredRecord {
  updatedAt: string;
  design: Design;
}

function readAll(): Record<string, StoredRecord> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, StoredRecord>) : {};
  } catch {
    // Corrupt or inaccessible (private browsing, quota, ...) — treat as empty
    // rather than throwing, same spirit as embed.ts's invalid-attribute fallback.
    return {};
  }
}

function writeAll(records: Record<string, StoredRecord>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

export const localStorageDesignStorage: DesignStorage = {
  async list() {
    return Object.values(readAll())
      .map(({ design, updatedAt }) => ({ id: design.id, name: design.name, updatedAt }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  async load(id) {
    const record = readAll()[id];
    if (!record) return undefined;
    try {
      return Design.parse(record.design);
    } catch {
      return undefined;
    }
  },

  async save(design) {
    const records = readAll();
    const updatedAt = new Date().toISOString();
    records[design.id] = { updatedAt, design };
    writeAll(records);
    return { id: design.id, name: design.name, updatedAt };
  },

  async remove(id) {
    const records = readAll();
    delete records[id];
    writeAll(records);
  },
};

let active: DesignStorage = localStorageDesignStorage;

/**
 * The one place that decides which backend `designStorage` below
 * delegates to. AccountButton.tsx is the only caller — see this file's
 * top doc comment.
 */
export function setActiveDesignStorage(storage: DesignStorage): void {
  active = storage;
}

/** The storage implementation the app actually uses — a thin proxy over
 * whatever setActiveDesignStorage() last set, so every consumer can hold
 * a single stable reference (imported once, at module load) rather than
 * re-reading which implementation is active on every call. */
export const designStorage: DesignStorage = {
  list: () => active.list(),
  load: (id) => active.load(id),
  save: (design) => active.save(design),
  remove: (id) => active.remove(id),
};
