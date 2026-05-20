"use client";

import React from "react";
import { createPortal } from "react-dom";
import { WikiPageSummary } from "@/types/wiki";
import { wikiTypeIcon, wikiTypeColor } from "./wiki-type-badge";

type Props = {
  /** Page pool to filter against. Caller is responsible for loading it. */
  pages: WikiPageSummary[];
  /** Substring the user has typed after `[[` (case-insensitive). */
  query: string;
  /** Viewport-relative caret position; popup anchors just below this line. */
  caret: { top: number; left: number; lineHeight: number };
  onPick: (page: WikiPageSummary) => void;
  onClose: () => void;
};

const MAX_RESULTS = 8;
const POPUP_WIDTH = 340;
const POPUP_MAX_HEIGHT = 280;

function score(page: WikiPageSummary, q: string): number {
  if (!q) return 0;
  const ql = q.toLowerCase();
  const slug = page.slug.toLowerCase();
  const title = page.title.toLowerCase();
  if (slug === ql || title === ql) return 100;
  if (slug.startsWith(ql) || title.startsWith(ql)) return 50;
  if (slug.includes(ql) || title.includes(ql)) return 20;
  return -1;
}

export function WikilinkAutocomplete({ pages, query, caret, onPick, onClose }: Props) {
  const [active, setActive] = React.useState(0);

  const filtered = React.useMemo(() => {
    if (!query) {
      return pages.slice(0, MAX_RESULTS);
    }
    const scored = pages
      .map((p) => ({ p, s: score(p, query) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, MAX_RESULTS);
    return scored.map((x) => x.p);
  }, [pages, query]);

  // Reset selection whenever the filter narrows.
  React.useEffect(() => {
    setActive(0);
  }, [query]);

  // Keyboard handler attached to window — the textarea is focused, not the popup.
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (filtered.length === 0) {
        if (e.key === "Escape") onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => (i + 1) % filtered.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => (i - 1 + filtered.length) % filtered.length);
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const pick = filtered[active];
        if (pick) onPick(pick);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    // capture: true so we run before the textarea's own key handlers.
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [filtered, active, onPick, onClose]);

  if (typeof window === "undefined") return null;

  // Anchor the popup just under the caret line. Flip above when it would
  // overflow the viewport bottom.
  const top = caret.top + caret.lineHeight + 4;
  const left = caret.left;
  const flipUp = top + POPUP_MAX_HEIGHT > window.innerHeight - 16;
  const finalTop = flipUp ? caret.top - POPUP_MAX_HEIGHT - 4 : top;
  const finalLeft = Math.min(left, window.innerWidth - POPUP_WIDTH - 16);

  return createPortal(
    <div
      style={{
        position: "fixed",
        top: finalTop,
        left: finalLeft,
        width: POPUP_WIDTH,
        maxHeight: POPUP_MAX_HEIGHT,
        zIndex: 100,
      }}
      className="rounded-lg border border-border bg-popover text-popover-foreground shadow-lg overflow-hidden flex flex-col"
      onMouseDown={(e) => e.preventDefault()} // keep textarea focused
    >
      <div className="px-3 py-1.5 border-b border-border bg-muted/40 flex items-center justify-between text-[10px] uppercase tracking-wide text-muted-foreground">
        <span>Link to page</span>
        <span className="font-mono">↑↓ Enter</span>
      </div>
      {filtered.length === 0 ? (
        <div className="px-3 py-4 text-xs text-muted-foreground italic">
          No pages match &ldquo;{query}&rdquo;.
        </div>
      ) : (
        <ul className="overflow-y-auto py-1" style={{ maxHeight: POPUP_MAX_HEIGHT - 32 }}>
          {filtered.map((p, i) => {
            const isActive = i === active;
            return (
              <li key={`${p.slug}:${p.scope_type}:${p.scope_id ?? ""}`}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => onPick(p)}
                  className={`w-full flex items-start gap-2 px-3 py-2 text-left transition-colors ${
                    isActive ? "bg-accent" : "hover:bg-accent/50"
                  }`}
                >
                  <span
                    className="material-symbols-outlined shrink-0 mt-0.5"
                    style={{ fontSize: 16, color: wikiTypeColor(p.page_type) }}
                  >
                    {wikiTypeIcon(p.page_type)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{p.title}</p>
                    <p className="text-[11px] text-muted-foreground font-mono truncate">
                      {p.slug}
                      {p.scope_type && p.scope_type !== "global" && p.scope_name && (
                        <span className="ml-1.5 text-muted-foreground/70">
                          · {p.scope_name}
                        </span>
                      )}
                    </p>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>,
    document.body,
  );
}
