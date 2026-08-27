import { api } from "./client";
import type { Visibility } from "../visibility";
import type { DesignSummary } from "../designStorage";

export interface CollectionAuthor {
  id: number;
  name: string | null;
  username: string | null;
}

export interface CollectionSummary {
  id: string;
  name: string;
  description: string | null;
  visibility: Visibility;
  /** Null when the caller asked for neither a count nor the designs. */
  designCount: number | null;
  updatedAt: string;
  author: CollectionAuthor;
}

export interface CollectionDetail extends CollectionSummary {
  /** What the *viewer* may see: a published collection can hold the
   * owner's private designs, and those are filtered out server-side for
   * everyone else (see the backend's Collection::toDetail). */
  designs: DesignSummary[];
}

interface CollectionRow {
  id: string;
  name: string;
  description: string | null;
  visibility: Visibility;
  design_count: number | null;
  updated_at: string;
  author: CollectionAuthor;
  designs?: Array<{ id: string; name: string; visibility: Visibility; updated_at: string }>;
}

const toSummary = (row: CollectionRow): CollectionSummary => ({
  id: row.id,
  name: row.name,
  description: row.description,
  visibility: row.visibility,
  designCount: row.design_count,
  updatedAt: row.updated_at,
  author: row.author,
});

const toDetail = (row: CollectionRow): CollectionDetail => ({
  ...toSummary(row),
  designs: (row.designs ?? []).map((d) => ({ id: d.id, name: d.name, visibility: d.visibility, updatedAt: d.updated_at })),
});

export async function listMyCollections(): Promise<CollectionSummary[]> {
  return (await api.get<CollectionRow[]>("/api/collections")).map(toSummary);
}

export async function loadCollection(id: string): Promise<CollectionDetail> {
  return toDetail(await api.get<CollectionRow>(`/api/collections/${id}`));
}

/** Upsert-by-id, same as designs and templates — the client mints the id. */
export async function saveCollection(input: { id: string; name: string; description?: string; visibility?: Visibility }): Promise<CollectionDetail> {
  const { id, ...body } = input;

  return toDetail(await api.put<CollectionRow>(`/api/collections/${id}`, body));
}

export async function setCollectionVisibility(id: string, visibility: Visibility): Promise<CollectionSummary> {
  return toSummary(await api.post<CollectionRow>(`/api/collections/${id}/publish`, { visibility }));
}

export async function deleteCollection(id: string): Promise<void> {
  await api.delete(`/api/collections/${id}`);
}

export async function addDesignToCollection(collectionId: string, designId: string): Promise<CollectionDetail> {
  return toDetail(await api.put<CollectionRow>(`/api/collections/${collectionId}/designs/${designId}`, {}));
}

export async function removeDesignFromCollection(collectionId: string, designId: string): Promise<CollectionDetail> {
  return toDetail(await api.delete<CollectionRow>(`/api/collections/${collectionId}/designs/${designId}`));
}
