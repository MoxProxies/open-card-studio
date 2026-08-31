import { api } from "./client";

/**
 * Things that happened to this account. Read-only from the client's side
 * — nothing here creates a notification, which is the backend's job at
 * the point the thing actually happened.
 */

export interface AppNotification {
  id: number;
  type: "reaction" | "comment" | "remix" | "badge" | "moderation" | "appeal";
  /** Null for anything the system did on its own, and for an actor whose
   * account has since gone. */
  actor: { name: string | null; username: string | null } | null;
  subject_type: string | null;
  subject_id: string | null;
  /** Enough to render the row without the subject, which may be deleted. */
  data: { title?: string; badge?: string; reason?: string; state?: string; response?: string; actor_name?: string };
  read: boolean;
  at: string;
}

export const loadNotifications = () => api.get<{ notifications: AppNotification[]; unread: number }>("/api/notifications");

/** Marks one row read, or everything when no id is given. */
export const markNotificationsRead = (id?: number) => api.post<{ unread: number }>("/api/notifications/read", id === undefined ? {} : { id });

/** One sentence per notification, built here rather than stored: the
 * wording is presentation, and a stored sentence would be frozen at the
 * moment it was written (and untranslatable later). */
export function describeNotification(notification: AppNotification): string {
  const who = notification.actor?.name ?? notification.data.actor_name ?? "Someone";
  const what = notification.data.title ? `“${notification.data.title}”` : "your work";

  switch (notification.type) {
    case "reaction":
      return `${who} liked ${what}.`;
    case "comment":
      return `${who} commented on ${what}.`;
    case "remix":
      return `${who} remixed ${what}.`;
    case "badge":
      return `You earned the ${notification.data.badge ?? "a"} badge.`;
    case "moderation":
      return `${what} was removed by moderation${notification.data.reason ? `: ${notification.data.reason}` : "."}`;
    case "appeal":
      return notification.data.state === "granted"
        ? `Your appeal was granted.${notification.data.response ? ` ${notification.data.response}` : ""}`
        : `Your appeal was declined.${notification.data.response ? ` ${notification.data.response}` : ""}`;
    default:
      return "Something happened.";
  }
}
