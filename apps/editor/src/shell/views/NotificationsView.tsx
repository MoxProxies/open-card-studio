import { useEffect, useState } from "react";
import { ArrowLeft, Bell, Check } from "lucide-react";
import { apiErrorMessage } from "../../api/client";
import { describeNotification, loadNotifications, markNotificationsRead, type AppNotification } from "../../api/notifications";
import { ListRow } from "../../components/ListRow";
import { navigate } from "../navStore";
import { Page } from "../Page";

/**
 * What happened while you were away. A subpage of Profile
 * (`#/profile/notifications`) — it used to be a modal off a top-bar bell,
 * but that bell was one more thing crammed into an already-tight header,
 * and the unread count now lives on the Profile tab itself instead (see
 * AppShell.tsx), so there's nothing left that needs a permanent spot in
 * the header.
 *
 * Opening it doesn't mark everything read — that's a button, because
 * "seen" and "dealt with" aren't the same thing, and a moderation
 * decision or a granted appeal is something you may well want to come
 * back to.
 */
export function NotificationsView({ onUnreadChange }: { onUnreadChange: (unread: number) => void }) {
  const [notifications, setNotifications] = useState<AppNotification[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadNotifications()
      .then(({ notifications: rows, unread }) => {
        setNotifications(rows);
        onUnreadChange(unread);
      })
      .catch((problem: unknown) => setError(apiErrorMessage(problem, "Couldn't load your notifications.")));
    // Deliberately once on mount — same as the modal this replaced, this
    // isn't polled (see AppShell's own comment on the unread count).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markAll = async () => {
    const { unread } = await markNotificationsRead();
    setNotifications((rows) => rows?.map((row) => ({ ...row, read: true })) ?? rows);
    onUnreadChange(unread);
  };

  const unreadCount = notifications?.filter((n) => !n.read).length ?? 0;

  return (
    <Page
      testId="page-profile-notifications"
      title="Notifications"
      actions={
        unreadCount > 0 ? (
          <button type="button" className="cs-btn" onClick={() => void markAll()} data-testid="notifications-read-all">
            <Check size={17} /> Mark all read
          </button>
        ) : undefined
      }
    >
      <div style={{ padding: "0 8px", display: "flex", flexDirection: "column", gap: 10 }}>
        <button className="cs-btn" onClick={() => navigate({ tab: "profile" })} style={{ alignSelf: "flex-start" }} data-testid="notifications-back">
          <ArrowLeft size={17} /> Profile
        </button>

        {error && <p style={{ color: "var(--cs-danger)", fontSize: 15, margin: 0 }}>{error}</p>}

        {notifications === null && !error && <p style={{ fontSize: 15, color: "var(--cs-text-muted)", margin: 0 }}>Loading…</p>}

        {notifications?.length === 0 && (
          <p style={{ fontSize: 15, color: "var(--cs-text-muted)", margin: 0 }} data-testid="notifications-empty">
            Nothing yet. Likes, comments and remixes of your work show up here.
          </p>
        )}

        {notifications?.map((notification) => (
          <ListRow
            key={notification.id}
            testId="notification-row"
            attrs={{ "data-read": String(notification.read), "data-type": notification.type }}
            icon={<Bell size={18} style={{ color: notification.read ? "var(--cs-text-muted)" : "var(--cs-accent)" }} />}
            title={describeNotification(notification)}
            subtitle={new Date(notification.at).toLocaleString()}
          />
        ))}
      </div>
    </Page>
  );
}
