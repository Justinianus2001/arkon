"use client";

import React from "react";
import { NotificationItem } from "@/types/notification";

type Props = {
  open: boolean;
  loading: boolean;
  items: NotificationItem[];
  onClose: () => void;
  onMarkAllRead: () => void;
  onItemClick: (n: NotificationItem) => void;
};

function relativeTime(iso: string): string {
  const date = new Date(iso);
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function typeIcon(type: string): string {
  if (type.includes("approved")) return "check_circle";
  if (type.includes("rejected")) return "cancel";
  if (type.includes("changes_requested")) return "edit_note";
  if (type.includes("resubmitted")) return "refresh";
  if (type.includes("withdrawn")) return "remove_circle";
  return "inbox";
}

function typeAccent(type: string): string {
  if (type.includes("approved")) return "text-emerald-600";
  if (type.includes("rejected")) return "text-destructive";
  if (type.includes("changes_requested")) return "text-blue-600";
  if (type.includes("withdrawn")) return "text-muted-foreground";
  return "text-amber-600";
}

export function NotificationDrawer({
  open,
  loading,
  items,
  onClose,
  onMarkAllRead,
  onItemClick,
}: Props) {
  if (!open) return null;

  const hasUnread = items.some((n) => !n.read_at);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      onClick={onClose}
      role="dialog"
      aria-label="Notifications"
    >
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-[1px]"
        aria-hidden="true"
      />
      <div
        className="relative h-full w-full max-w-md bg-background border-l border-border shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-muted-foreground" style={{ fontSize: 20 }}>
              notifications
            </span>
            <h2 className="text-sm font-semibold">Notifications</h2>
          </div>
          <div className="flex items-center gap-1">
            {hasUnread && (
              <button
                type="button"
                onClick={onMarkAllRead}
                className="text-xs text-primary hover:underline px-2 py-1"
              >
                Mark all read
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded hover:bg-secondary"
              aria-label="Close"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                close
              </span>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && items.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">Loading…</div>
          ) : items.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              No notifications yet.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => onItemClick(n)}
                    className={`w-full text-left px-4 py-3 hover:bg-secondary/50 transition-colors flex gap-3 ${
                      n.read_at ? "" : "bg-primary/5"
                    }`}
                  >
                    <span
                      className={`material-symbols-outlined shrink-0 mt-0.5 ${typeAccent(n.type)}`}
                      style={{ fontSize: 18 }}
                    >
                      {typeIcon(n.type)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p
                        className={`text-sm leading-snug ${
                          n.read_at ? "text-muted-foreground" : "font-medium"
                        }`}
                      >
                        {n.subject}
                      </p>
                      {n.body && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>
                      )}
                      <p className="text-[11px] text-muted-foreground mt-1 tabular-nums">
                        {relativeTime(n.created_at)}
                      </p>
                    </div>
                    {!n.read_at && (
                      <span
                        className="shrink-0 mt-1 w-2 h-2 rounded-full bg-primary"
                        aria-label="Unread"
                      />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
