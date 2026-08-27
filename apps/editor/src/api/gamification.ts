import { api } from "./client";

export interface ReactionState {
  reaction_count: number;
  reacted: boolean;
  featured?: boolean;
}

/** What can be liked or featured. Mirrors the backend's Support\Reactable::TYPES. */
export type ReactableType = "design" | "template" | "collection" | "post";

export interface LevelProgress {
  points: number;
  level: number;
  level_name: string;
  next_level_at: number | null;
  points_to_next: number | null;
  reactions_received: number;
}

export interface BadgeInfo {
  id: string;
  name: string;
  description: string;
  icon: string;
  /** False for badges only a human can hand out. */
  automatic: boolean;
}

/** Toggles: reacts if you haven't, un-reacts if you have. The response
 * always describes the resulting state, so nothing has to be guessed. */
export async function toggleReaction(type: ReactableType, id: string): Promise<{ reacted: boolean; reaction_count: number }> {
  return api.post("/api/reactions", { type, id });
}

export async function setFeatured(type: ReactableType, id: string, featured: boolean): Promise<{ featured: boolean }> {
  return api.post("/api/featured", { type, id, featured });
}

export async function loadBadgeCatalog(): Promise<BadgeInfo[]> {
  return api.get("/api/badges");
}
