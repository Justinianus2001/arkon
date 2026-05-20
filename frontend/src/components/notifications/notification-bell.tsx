"use client";

import React from "react";
import { api } from "@/lib/api";
import { NotificationItem } from "@/types/notification";
import { NotificationDrawer } from "./notification-drawer";

const POLL_INTERVAL_MS = 30_000;

export function NotificationBell() {
  const [unread, setUnread] = React.useState(0);
  const [open, setOpen] = React.useState(false);
  const [items, setItems] = React.useState<NotificationItem[]>([]);
  const [loading, setLoading] = React.useState(false);

  const refreshCount = React.useCallback(async () => {
    try {
      const res = await api<{ count: number }>("/api/notifications/unread-count");
      setUnread(res.count);
    } catch {
      // Silent — auth or transient failure; next poll will retry.
    }
  }, []);

  // Initial fetch + interval polling.
  React.useEffect(() => {
    refreshCount();
    const id = setInterval(refreshCount, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refreshCount]);

  const handleOpen = async () => {
    setOpen(true);
    setLoading(true);
    try {
      const list = await api<NotificationItem[]>("/api/notifications?limit=50");
      setItems(list);
    } finally {
      setLoading(false);
    }
  };

  const handleMarkAllRead = async () => {
    await api("/api/notifications/read-all", { method: "POST" });
    setItems((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
    setUnread(0);
  };

  const handleItemClick = async (n: NotificationItem) => {
    if (!n.read_at) {
      try {
        await api(`/api/notifications/${n.id}/read`, { method: "POST" });
        setItems((prev) =>
          prev.map((it) => (it.id === n.id ? { ...it, read_at: new Date().toISOString() } : it))
        );
        setUnread((c) => Math.max(0, c - 1));
      } catch {
        /* ignore */
      }
    }
    // Deep-link routes for drafts/contributions land in the existing wiki /
    // skill UI in a follow-up; for now just dismiss the drawer.
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="relative flex items-center justify-center w-9 h-9 rounded-full hover:bg-secondary transition-colors"
        aria-label="Notifications"
        title="Notifications"
      >
        <span className="material-symbols-outlined text-muted-foreground" style={{ fontSize: 20 }}>
          notifications
        </span>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      <NotificationDrawer
        open={open}
        loading={loading}
        items={items}
        onClose={() => setOpen(false)}
        onMarkAllRead={handleMarkAllRead}
        onItemClick={handleItemClick}
      />
    </>
  );
}
