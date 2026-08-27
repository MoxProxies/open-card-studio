import { api } from "./client";
import type { AuthUser } from "./auth";
import type { TemplateSummary } from "./templates";
import type { CollectionSummary } from "./collections";
import type { BadgeInfo, LevelProgress, ReactableType } from "./gamification";

export interface PublicProfile {
  id: number;
  username: string;
  name: string;
  bio: string | null;
  avatar_url: string | null;
  joined_at: string;
}

export interface ProfileDesign {
  id: string;
  name: string;
  visibility: string;
  updated_at: string;
  reaction_count?: number;
  reacted?: boolean;
  featured?: boolean;
}

/** A row on the profile's featured shelf — any content type, tagged. */
export interface FeaturedItem extends ProfileDesign {
  type: ReactableType;
  description?: string | null;
}

export interface ProfilePage {
  profile: PublicProfile;
  stats: LevelProgress;
  badges: BadgeInfo[];
  featured: FeaturedItem[];
  templates: TemplateSummary[];
  designs: ProfileDesign[];
  collections: CollectionSummary[];
}

interface ProfileRow {
  profile: PublicProfile;
  stats: LevelProgress;
  badges: BadgeInfo[];
  featured: FeaturedItem[];
  templates: Array<Record<string, unknown>>;
  designs: ProfileDesign[];
  collections: Array<Record<string, unknown>>;
}

/** A public profile and everything that account has published. No auth —
 * this is where a shared template link leads. */
export async function loadProfile(username: string): Promise<ProfilePage> {
  const row = await api.get<ProfileRow>(`/api/users/${encodeURIComponent(username)}`);

  return {
    profile: row.profile,
    stats: row.stats,
    badges: row.badges ?? [],
    featured: row.featured ?? [],
    designs: row.designs,
    collections: (row.collections ?? []).map((c) => ({
      id: c.id as string,
      name: c.name as string,
      description: (c.description ?? null) as string | null,
      visibility: c.visibility as CollectionSummary["visibility"],
      designCount: (c.design_count ?? null) as number | null,
      updatedAt: c.updated_at as string,
      author: c.author as CollectionSummary["author"],
    })),
    templates: row.templates.map((t) => ({
      id: t.id as string,
      name: t.name as string,
      description: (t.description ?? null) as string | null,
      tags: (t.tags ?? []) as string[],
      visibility: t.visibility as TemplateSummary["visibility"],
      usageCount: t.usage_count as number,
      version: t.version as number,
      updatedAt: t.updated_at as string,
      author: t.author as TemplateSummary["author"],
      reactionCount: (t.reaction_count ?? 0) as number,
      reacted: (t.reacted ?? false) as boolean,
      featured: (t.featured ?? false) as boolean,
    })),
  };
}

export interface ProfileEdit {
  name?: string;
  username?: string;
  bio?: string;
  avatar_url?: string | null;
}

export async function updateProfile(edit: ProfileEdit): Promise<AuthUser> {
  return api.patch<AuthUser>("/api/profile", edit);
}

/** What a client may report. Mirrors ReportController::REPORTABLE. */
/** Mirrors the backend's ReportController::REPORTABLE — everything a
 * report can point at, which is a superset of what can be liked (an
 * account can be reported but not liked). */
export type ReportableType = "template" | "design" | "user" | "collection" | "post" | "comment";

/** Mirrors ReportController::REASONS — a shortlist for the UI, not a schema constraint. */
export const REPORT_REASONS = [
  { value: "infringement", label: "Infringes someone's rights" },
  { value: "inappropriate", label: "Inappropriate content" },
  { value: "spam", label: "Spam" },
  { value: "impersonation", label: "Impersonation" },
  { value: "other", label: "Something else" },
] as const;

export async function reportContent(type: ReportableType, id: string, reason: string, details: string): Promise<void> {
  await api.post("/api/reports", { type, id, reason, details: details.trim() || null });
}
