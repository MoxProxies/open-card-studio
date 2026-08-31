import { useEffect, useState } from "react";
import { Bell, Check } from "lucide-react";
import { apiErrorMessage } from "../api/client";
import { describeNotification, loadNotifications, markNotificationsRead, type AppNotification } from "../api/notifications";
import { ListRow } from "./ListRow";
import { Modal } from "./Modal";

/**
 * What happened while you were away.
 *
 * Opening it doesn't mark everything read — that's a button, because
 * "seen" and "dealt with" aren't the same thing, and a moderation
 * decision or a granted appeal is something you may well want to come
 * back to.
 */
export function NotificationsModal({ onClose, onRead }: { onClose: () => void; onRead: (unread: number) => void }) {
  const [notifications, setNotifications] = useState<AppNotification[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadNotifications()
      .then(({ notifications: rows, unread }) => {
        setNotifications(rows);
        onRead(unread);
      })
      .catch((problem: unknown) => setError(apiErrorMessage(problem, "Couldn't load your notifications.")));
  }, [onRead]);

  const markAll = async () => {
    const { unread } = await markNotificationsRead();
    setNotifications((rows) => rows?.map((row) => ({ ...row, read: true })) ?? rows);
    onRead(unread);
  };

  const unreadCount = notifications?.filter((n) => !n.read).length ?? 0;

  return (
    <Modal
      title="Notifications"
      onClose={onClose}
      width="min(520px, 92vw)"
      testId="notifications"
      footer={
        unreadCount > 0 ? (
          <button type="button" className="cs-btn" onClick={() => void markAll()} data-testid="notifications-read-all">
            <Check size={14} /> Mark all read
          </button>
        ) : undefined
      }
    >
      <div style={{ padding: 8 }}>
        {error && <p style={{ color: "var(--cs-danger)", fontSize: 13, margin: "0 0 8px" }}>{error}</p>}

        {notifications === null && !error && <p style={{ fontSize: 13, color: "var(--cs-text-muted)", margin: 0 }}>Loading…</p>}

        {notifications?.length === 0 && (
          <p style={{ fontSize: 13, color: "var(--cs-text-muted)", margin: 0 }} data-testid="notifications-empty">
            Nothing yet. Likes, comments and remixes of your work show up here.
          </p>
        )}

        {notifications?.map((notification) => (
          <ListRow
            key={notification.id}
            testId="notification-row"
            attrs={{ "data-read": String(notification.read), "data-type": notification.type }}
            icon={<Bell size={15} style={{ color: notification.read ? "var(--cs-text-muted)" : "var(--cs-accent)" }} />}
            title={describeNotification(notification)}
            subtitle={new Date(notification.at).toLocaleString()}
          />
        ))}
      </div>
    </Modal>
  );
}
