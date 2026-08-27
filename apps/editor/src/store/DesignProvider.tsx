import { createContext, useContext, useState, type ReactNode } from "react";
import type { Design } from "@card-studio/scene-schema";
import { createDesignStore, type DesignStore, type DesignState } from "./designStore";
import type { Entitlements } from "../entitlements";

/**
 * The store hook is created per <DesignProvider> instance (not a module
 * singleton) so multiple embedded editors can live on the same page
 * without sharing state.
 *
 * Accepts either a ready-made `store` (so a caller — e.g. the embed
 * custom element — can hold a reference to the same store the React
 * tree renders from) or an `initialDesign` (+ optional
 * `initialEntitlements`, standalone-app callers only — the embed element
 * builds its own store with createDesignStore directly, see embed.ts) to
 * create one internally.
 */
const DesignStoreContext = createContext<DesignStore | null>(null);

type DesignProviderProps = { children: ReactNode } & (
  | { store: DesignStore; initialDesign?: undefined; initialEntitlements?: undefined; hideLocalDesignLibrary?: undefined }
  | { initialDesign: Design; initialEntitlements?: Entitlements; hideLocalDesignLibrary?: boolean; store?: undefined }
);

export function DesignProvider({ store, initialDesign, initialEntitlements, hideLocalDesignLibrary, children }: DesignProviderProps) {
  const [ownStore] = useState(() => store ?? createDesignStore(initialDesign!, initialEntitlements, hideLocalDesignLibrary));
  return <DesignStoreContext.Provider value={ownStore}>{children}</DesignStoreContext.Provider>;
}

export function useDesignStore<T>(selector: (state: DesignState) => T): T {
  const store = useContext(DesignStoreContext);
  if (!store) throw new Error("useDesignStore must be used within a DesignProvider");
  return store(selector);
}
