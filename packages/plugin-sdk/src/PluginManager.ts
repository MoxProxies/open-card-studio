import type { AssetPackPlugin, ImportSourcePlugin } from "./types.js";

type Listener = () => void;

/**
 * The single registry an app instantiates once (see apps/editor's
 * src/plugins.ts) and registers its plugins into at startup. Deliberately
 * not a singleton/module-level export here — a host embedding multiple
 * editor instances, or a test, needs its own isolated registry.
 *
 * "Active" is tracked separately from "registered": installing a plugin
 * doesn't force it on, and only one import source / asset pack can be
 * active at a time (multiple *registered* import sources are fine — the
 * editor would show a picker — but exactly one is ever "the" active one
 * for a given "Import" click).
 */
export class PluginManager {
  private importSources = new Map<string, ImportSourcePlugin>();
  private assetPacks = new Map<string, AssetPackPlugin>();
  private activeImportSourceId: string | null = null;
  private activeAssetPackId: string | null = null;
  private listeners = new Set<Listener>();

  registerImportSource(plugin: ImportSourcePlugin, options: { activate?: boolean } = {}): void {
    this.importSources.set(plugin.id, plugin);
    if (options.activate ?? this.activeImportSourceId === null) {
      this.activeImportSourceId = plugin.id;
    }
    this.notify();
  }

  registerAssetPack(plugin: AssetPackPlugin, options: { activate?: boolean } = {}): void {
    this.assetPacks.set(plugin.id, plugin);
    if (options.activate ?? this.activeAssetPackId === null) {
      this.activeAssetPackId = plugin.id;
    }
    this.notify();
  }

  unregisterImportSource(id: string): void {
    this.importSources.delete(id);
    if (this.activeImportSourceId === id) {
      this.activeImportSourceId = this.importSources.keys().next().value ?? null;
    }
    this.notify();
  }

  listImportSources(): ImportSourcePlugin[] {
    return Array.from(this.importSources.values());
  }

  listAssetPacks(): AssetPackPlugin[] {
    return Array.from(this.assetPacks.values());
  }

  getActiveImportSource(): ImportSourcePlugin | undefined {
    return this.activeImportSourceId ? this.importSources.get(this.activeImportSourceId) : undefined;
  }

  getActiveAssetPack(): AssetPackPlugin | undefined {
    return this.activeAssetPackId ? this.assetPacks.get(this.activeAssetPackId) : undefined;
  }

  setActiveImportSource(id: string | null): void {
    if (id !== null && !this.importSources.has(id)) {
      throw new Error(`Cannot activate unregistered import source plugin "${id}".`);
    }
    this.activeImportSourceId = id;
    this.notify();
  }

  setActiveAssetPack(id: string): void {
    if (!this.assetPacks.has(id)) {
      throw new Error(`Cannot activate unregistered asset pack plugin "${id}".`);
    }
    this.activeAssetPackId = id;
    this.notify();
  }

  /** For React components that need to re-render when active plugins change (e.g. after a runtime install). */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
