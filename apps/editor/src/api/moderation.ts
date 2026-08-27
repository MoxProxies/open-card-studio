import { api } from "./client";
import type { BadgeInfo } from "./gamification";

export type ReportState = "open" | "reviewed" | "actioned" | "dismissed";

export interface QueuedReport {
  id: number;
  reason: string;
  details: string | null;
  state: ReportState;
  reported_at: string;
  reporter: { id: number; name: string | null };
  target: {
    type: string;
    id: string;
    label?: string;
    owner?: string | number | null;
    moderation_state?: string | null;
    gone?: boolean;
  };
}

export interface AuditEntry {
  id: number;
  action: string;
  target_type: string;
  target_id: string;
  reason: string | null;
  at: string;
  actor: string | null;
}

export const loadReportQueue = (state: ReportState | "all" = "open") => api.get<QueuedReport[]>(`/api/moderation/reports?state=${state}`);

export const resolveReport = (id: number, state: ReportState, reason?: string) =>
  api.post<{ id: number; state: ReportState }>(`/api/moderation/reports/${id}`, { state, reason });

/** `removed` hides content from everyone, its owner included, and reverses
 * the points it earned. A reason is required to remove. */
export const takedown = (type: string, id: string, removed: boolean, reason?: string) =>
  api.post<{ id: string; moderation_state: string }>("/api/moderation/takedown", { type, id, removed, reason });

export const suspendUser = (id: number, suspended: boolean, reason?: string) =>
  api.post<{ id: number; moderation_state: string }>(`/api/moderation/users/${id}/suspend`, { suspended, reason });

export const setUserBadge = (id: number, badge: string, granted: boolean, reason?: string) =>
  api.post<{ id: number; badges: BadgeInfo[] }>(`/api/moderation/users/${id}/badges`, { badge, granted, reason });

export const loadAuditTrail = () => api.get<AuditEntry[]>("/api/moderation/actions");
