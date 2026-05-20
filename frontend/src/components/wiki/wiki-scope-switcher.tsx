"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { WikiScope } from "@/types/wiki";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const SCOPE_ICONS: Record<string, string> = {
  global: "public",
  department: "corporate_fare",
  project: "folder_special",
};

function scopeKey(s: { scope_type: string; scope_id: string | null }): string {
  return s.scope_id ? `${s.scope_type}:${s.scope_id}` : s.scope_type;
}

type Props = {
  /** The currently selected scope — used to label the trigger and check-mark
   *  the active item in the menu. */
  current: WikiScope;
};

/**
 * Dropdown that lists the scopes the current user can access (global plus
 * their departments and projects) and navigates to /wiki?scope_type=&scope_id=
 * when one is selected. Used in both the wiki index page header and the
 * detail page header so users can jump between scoped views from anywhere.
 */
export function WikiScopeSwitcher({ current }: Props) {
  const router = useRouter();
  const [scopes, setScopes] = React.useState<WikiScope[]>([]);

  React.useEffect(() => {
    api<WikiScope[]>("/api/wiki/my-scopes")
      .then((s) => setScopes(Array.isArray(s) ? s : []))
      .catch(() => setScopes([]));
  }, []);

  const select = (s: WikiScope) => {
    const params = new URLSearchParams();
    if (s.scope_type !== "global") {
      params.set("scope_type", s.scope_type);
      if (s.scope_id) params.set("scope_id", s.scope_id);
    }
    const qs = params.toString();
    router.push(qs ? `/wiki?${qs}` : "/wiki");
  };

  if (scopes.length <= 1) return null;
  const currentKey = scopeKey(current);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex h-8 items-center gap-1.5 px-2.5 rounded-lg border border-border bg-card hover:bg-accent text-sm font-medium text-foreground transition-colors">
        <span
          className="material-symbols-outlined text-base text-muted-foreground"
          style={{ fontSize: 16 }}
        >
          {SCOPE_ICONS[current.scope_type] ?? "tune"}
        </span>
        <span className="max-w-[160px] truncate">{current.name}</span>
        <span className="material-symbols-outlined text-base text-muted-foreground">
          expand_more
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[220px]">
        {scopes.map((s) => {
          const k = scopeKey(s);
          const active = k === currentKey;
          return (
            <DropdownMenuItem
              key={k}
              onClick={() => select(s)}
              className={active ? "bg-accent/60" : ""}
            >
              <span
                className="material-symbols-outlined text-base mr-2 text-muted-foreground"
                style={{ fontSize: 16 }}
              >
                {SCOPE_ICONS[s.scope_type] ?? "tune"}
              </span>
              <span className="flex-1 truncate">{s.name}</span>
              {active && (
                <span
                  className="material-symbols-outlined text-base ml-2 text-primary"
                  style={{ fontSize: 16 }}
                >
                  check
                </span>
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
