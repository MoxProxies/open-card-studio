import { api } from "./client";
import type { AuthUser } from "./auth";
import type { TemplateSummary } from "./templates";

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
}

export interface ProfilePage {
  profile: PublicProfile;
  templates: TemplateSummary[];
  designs: ProfileDesign[];
}

interface ProfileRow {
  profile: PublicProfile;
  templates: Array<Record<string, unknown>>;
  designs: ProfileDesign[];
}

/** A public profile and everything that account has published. No auth —
 * this is where a shared template link leads. */
export async function loadProfile(username: string): Promise<ProfilePage> {
  const row = await api.get<ProfileRow>(`/api/users/${encodeURIComponent(username)}`);

  return {
    profile: row.profile,
    designs: row.designs,
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
export type ReportableType = "template" | "design" | "user";

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
