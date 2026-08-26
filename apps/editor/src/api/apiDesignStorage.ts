import { Design } from "@card-studio/scene-schema";
import type { DesignStorage, DesignSummary } from "../designStorage";
import { api } from "./client";

interface CardDesignSummaryRow {
  id: string;
  name: string;
  updated_at: string;
}

interface CardDesignRow extends CardDesignSummaryRow {
  design: unknown;
  visibility: string;
}

/**
 * The backend-backed DesignStorage implementation — see designStorage.ts's
 * doc comment for why this is a drop-in swap rather than a rewrite of any
 * consumer (Toolbar.tsx, DesignLibraryModal.tsx). AccountButton.tsx is
 * the only caller of setActiveDesignStorage(apiDesignStorage), switching
 * this in once a user is actually signed in and back to
 * localStorageDesignStorage on sign-out — every method below assumes
 * it's only ever called while authenticated (see client.ts's bearer
 * token attachment); an unauthenticated call 401s same as any other
 * protected endpoint would.
 */
export const apiDesignStorage: DesignStorage = {
  async list(): Promise<DesignSummary[]> {
    const rows = await api.get<CardDesignSummaryRow[]>("/api/card-designs");

    return rows.map((row) => ({ id: row.id, name: row.name, updatedAt: row.updated_at }));
  },

  async load(id: string): Promise<Design | undefined> {
    try {
      const row = await api.get<CardDesignRow>(`/api/card-designs/${id}`);

      return Design.parse(row.design);
    } catch {
      return undefined;
    }
  },

  async save(design: Design): Promise<DesignSummary> {
    const row = await api.put<CardDesignRow>(`/api/card-designs/${design.id}`, {
      name: design.name,
      design,
    });

    return { id: row.id, name: row.name, updatedAt: row.updated_at };
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/api/card-designs/${id}`);
  },
};
