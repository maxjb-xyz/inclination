import { useState } from "react";
import type { NotificationItem } from "../api/collabTypes";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useUnreadCount,
} from "./collabQueries";

const TYPE_LABEL: Record<string, string> = {
  mention: "mentioned you",
  comment_reply: "replied",
  share: "shared a page with you",
  invite: "invited you",
};

function describe(n: NotificationItem): string {
  const action = TYPE_LABEL[n.type] ?? n.type;
  const where = n.preview?.pageTitle ? ` · ${n.preview.pageTitle}` : "";
  return `${action}${where}`;
}

export interface NotificationsBellProps {
  /** Open the page referenced by a notification (closes the dropdown). */
  onOpenPage: (pageId: string) => void;
}

/**
 * Header bell (spec §6): shows an unread badge (GET unread-count, polled) and a
 * dropdown of recent notifications (GET /notifications). Clicking a notification
 * marks it read and opens its referenced page; a "Mark all read" action clears
 * the badge.
 */
export function NotificationsBell({ onOpenPage }: NotificationsBellProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const unread = useUnreadCount();
  const notifications = useNotifications(open);
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  const count = unread.data?.count ?? 0;
  const items = notifications.data ?? [];

  function activate(n: NotificationItem): void {
    if (!n.readAt) markRead.mutate(n.id);
    const pageId = n.sourceRef.pageId;
    if (pageId) {
      onOpenPage(pageId);
      setOpen(false);
    }
  }

  return (
    <div className="notifications">
      <button
        type="button"
        className="notifications__bell"
        aria-label="Notifications"
        data-testid="notifications-bell"
        onClick={() => setOpen((o) => !o)}
      >
        🔔
        {count > 0 ? (
          <span className="notifications__badge" data-testid="notifications-badge">
            {count}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="notifications__panel" data-testid="notifications-panel" role="menu">
          <header className="notifications__panel-header">
            <span>Notifications</span>
            <button type="button" onClick={() => markAll.mutate()}>
              Mark all read
            </button>
          </header>
          {notifications.isLoading ? <p>Loading…</p> : null}
          {items.length === 0 && !notifications.isLoading ? (
            <p className="notifications__empty">You're all caught up.</p>
          ) : null}
          {items.map((n) => (
            <button
              key={n.id}
              type="button"
              role="menuitem"
              data-testid="notification-item"
              className={`notifications__item${n.readAt ? "" : " is-unread"}`}
              onClick={() => activate(n)}
            >
              {describe(n)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
