import React, { useState, useRef, useEffect, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { EmptyState } from "@/components/shared/empty-state";
import { api } from "@/lib/api";
import { Member, Employee, Project } from "./types";

type BulkAddResult = {
  added: number;
  skipped: number;
  errored: number;
  results: Array<{
    employee_id: string;
    status: "added" | "skipped" | "error" | string;
    message: string | null;
  }>;
};

const ROLE_DESCRIPTIONS: Record<string, string[]> = {
  viewer: [
    "View members, sources, and wiki pages of the workspace",
    "View the wiki graph and wiki index of the workspace",
    "No other permissions",
  ],
  contributor: [
    "All Viewer permissions",
    "Propose wiki drafts for pages in the workspace (create drafts pending editor approval)",
    "Propose edits via MCP (propose_wiki_edit)",
  ],
  editor: [
    "All Contributor permissions",
    "Direct edit wiki pages in the workspace (bypassing review)",
    "Approve or reject drafts for workspace pages",
    "Add or remove sources from the workspace (link existing source, upload file, add URL)",
    "Review drafts via MCP (list_pending_drafts, review_draft, approve_draft, reject_draft)",
    "Edit wiki via MCP (edit_wiki_page)",
  ],
  admin: [
    "All Editor permissions",
    "Add or remove members from the workspace",
    "Change member roles",
    "Rename or archive the workspace",
    "Cannot delete the workspace (only system admins can delete)",
    "Guard: cannot delete or demote yourself if you are the last admin",
  ],
};

type Props = {
  project: Project;
  members: Member[];
  isAdmin: boolean;
  availableEmployees: Employee[];
  onChanged: () => Promise<void>;
  onError: (msg: string | null) => void;
};

export function MembersTab({
  project,
  members,
  isAdmin,
  availableEmployees,
  onChanged,
  onError,
}: Props) {
  // Multi-select picker state — chips for selected employees + free-text query.
  const [picked, setPicked] = useState<Employee[]>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [selectedRole, setSelectedRole] = useState("viewer");
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<BulkAddResult | null>(null);
  const [updatingRoleFor, setUpdatingRoleFor] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Filter candidates: exclude already-picked + match name/email by case-insensitive substring.
  const pickedIds = useMemo(() => new Set(picked.map((p) => p.id)), [picked]);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return availableEmployees
      .filter((e) => !pickedIds.has(e.id))
      .filter((e) =>
        q === ""
          ? true
          : e.name.toLowerCase().includes(q) || e.email.toLowerCase().includes(q),
      )
      .slice(0, 50);
  }, [availableEmployees, pickedIds, query]);

  // Reset highlight when matches change.
  useEffect(() => { setHighlight(0); }, [query, picked.length]);

  // Close dropdown on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const pickEmployee = (emp: Employee) => {
    setPicked((prev) => (prev.some((p) => p.id === emp.id) ? prev : [...prev, emp]));
    setQuery("");
    setHighlight(0);
    inputRef.current?.focus();
  };

  const removePicked = (id: string) => {
    setPicked((prev) => prev.filter((p) => p.id !== id));
    inputRef.current?.focus();
  };

  const handleInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (matches[highlight]) pickEmployee(matches[highlight]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(matches.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === "Backspace" && query === "" && picked.length > 0) {
      // Pop the last chip when the input is empty.
      e.preventDefault();
      setPicked((prev) => prev.slice(0, -1));
    } else if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "Tab") {
      // Tab confirms the highlighted match if dropdown is open.
      if (open && matches[highlight]) {
        e.preventDefault();
        pickEmployee(matches[highlight]);
      }
    }
  };

  const handleAddMembers = async () => {
    if (picked.length === 0) return;
    onError(null);
    setBusy(true);
    setLastResult(null);
    try {
      const result = await api<BulkAddResult>(
        `/api/projects/${project.id}/members/bulk`,
        {
          method: "POST",
          body: {
            employee_ids: picked.map((p) => p.id),
            role: selectedRole,
          },
        },
      );
      setLastResult(result);
      // Keep only employees that errored so the user can retry/fix; drop ones
      // that were added or skipped (already a member, etc).
      const erroredIds = new Set(
        result.results.filter((r) => r.status === "error").map((r) => r.employee_id),
      );
      setPicked((prev) => prev.filter((p) => erroredIds.has(p.id)));
      await onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to add members");
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveMember = async (empId: string) => {
    if (!confirm("Remove this member from the project?")) return;
    onError(null);
    try {
      await api(`/api/projects/${project.id}/members/${empId}`, { method: "DELETE" });
      await onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to remove member");
    }
  };

  const handleUpdateRole = async (empId: string, newRole: string) => {
    onError(null);
    setUpdatingRoleFor(empId);
    try {
      await api(`/api/projects/${project.id}/members/${empId}`, {
        method: "PATCH",
        body: { role: newRole },
      });
      await onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to update role");
    } finally {
      setUpdatingRoleFor(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {isAdmin && (
        <div className="bg-card rounded-xl border border-border shadow-sahara p-4 flex flex-col gap-3">
          <div className="flex gap-2 items-start">
            {/* Typeahead + chips multi-select */}
            <div ref={wrapRef} className="relative flex-1 min-w-0">
              <div
                className="min-h-10 w-full rounded-md border border-input bg-background px-2 py-1.5 flex flex-wrap gap-1.5 items-center cursor-text focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30 transition-colors"
                onClick={() => { setOpen(true); inputRef.current?.focus(); }}
              >
                {picked.map((emp) => (
                  <span
                    key={emp.id}
                    className="inline-flex items-center gap-1 rounded bg-primary/15 text-primary text-xs px-1.5 py-0.5"
                  >
                    <span className="truncate max-w-[180px]">{emp.name}</span>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); removePicked(emp.id); }}
                      className="hover:bg-primary/20 rounded-sm p-0.5 -mr-0.5 transition-colors"
                      aria-label={`Remove ${emp.name}`}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 12 }}>close</span>
                    </button>
                  </span>
                ))}
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
                  onFocus={() => setOpen(true)}
                  onKeyDown={handleInputKey}
                  placeholder={picked.length === 0 ? "Type a name or email to search…" : ""}
                  className="flex-1 min-w-[180px] bg-transparent outline-none text-sm placeholder:text-muted-foreground"
                />
              </div>

              {/* Dropdown */}
              {open && matches.length > 0 && (
                <div className="absolute z-20 left-0 right-0 top-full mt-1 max-h-64 overflow-y-auto rounded-md border border-border bg-popover shadow-md py-1">
                  {matches.map((emp, i) => (
                    <button
                      key={emp.id}
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); pickEmployee(emp); }}
                      onMouseEnter={() => setHighlight(i)}
                      className={`w-full text-left px-3 py-1.5 flex items-center gap-2 text-sm transition-colors ${
                        i === highlight ? "bg-accent text-accent-foreground" : "hover:bg-muted"
                      }`}
                    >
                      <span className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <span className="material-symbols-outlined text-primary" style={{ fontSize: 14 }}>person</span>
                      </span>
                      <span className="flex flex-col min-w-0 flex-1">
                        <span className="truncate">{emp.name}</span>
                        <span className="text-[11px] text-muted-foreground truncate">{emp.email}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {open && query.trim() !== "" && matches.length === 0 && (
                <div className="absolute z-20 left-0 right-0 top-full mt-1 rounded-md border border-border bg-popover shadow-md px-3 py-2">
                  <p className="text-xs text-muted-foreground italic">No matching employees.</p>
                </div>
              )}
            </div>

            <Select value={selectedRole} onValueChange={(v) => setSelectedRole(v ?? "viewer")}>
              <SelectTrigger className="bg-background w-[130px] shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.keys(ROLE_DESCRIPTIONS).map((role) => (
                  <SelectItem key={role} value={role} className="capitalize">{role}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              disabled={picked.length === 0 || busy}
              onClick={handleAddMembers}
              className="bg-primary text-primary-foreground hover:bg-primary/90 shrink-0 gap-1.5"
            >
              {busy ? (
                <span className="material-symbols-outlined text-base animate-spin">progress_activity</span>
              ) : (
                <span className="material-symbols-outlined text-base">person_add</span>
              )}
              Add{picked.length > 0 ? ` ${picked.length}` : ""}
            </Button>
          </div>

          {/* Helper hints + per-batch result */}
          {picked.length === 0 && !lastResult && (
            <p className="text-[11px] text-muted-foreground">
              Tip: type to search, <kbd className="font-mono bg-muted px-1 rounded">↑↓</kbd> to navigate,
              <kbd className="font-mono bg-muted px-1 rounded ml-1">Enter</kbd> to pick,
              <kbd className="font-mono bg-muted px-1 rounded ml-1">Backspace</kbd> to remove last chip.
              All selected members will receive the role above.
            </p>
          )}

          {lastResult && (
            <div className="rounded-md border border-border bg-background/60 px-3 py-2 text-xs">
              <p>
                <span className="text-emerald-700 dark:text-emerald-300 font-medium">
                  {lastResult.added} added
                </span>
                {lastResult.skipped > 0 && (
                  <>
                    {" · "}
                    <span className="text-muted-foreground">{lastResult.skipped} skipped</span>
                  </>
                )}
                {lastResult.errored > 0 && (
                  <>
                    {" · "}
                    <span className="text-destructive">{lastResult.errored} errored</span>
                  </>
                )}
              </p>
              {(lastResult.skipped > 0 || lastResult.errored > 0) && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">
                    Details
                  </summary>
                  <ul className="mt-1 space-y-0.5">
                    {lastResult.results
                      .filter((r) => r.status !== "added")
                      .map((r) => {
                        const emp = availableEmployees.find((e) => e.id === r.employee_id) ||
                          members.find((m) => m.employee_id === r.employee_id);
                        const label = emp
                          ? "name" in emp ? emp.name : emp.employee_name
                          : r.employee_id.slice(0, 8);
                        return (
                          <li
                            key={r.employee_id}
                            className={r.status === "error" ? "text-destructive" : "text-muted-foreground"}
                          >
                            <span className="font-medium">{label}</span>
                            {r.message ? ` — ${r.message}` : ""}
                          </li>
                        );
                      })}
                  </ul>
                </details>
              )}
              <button
                type="button"
                onClick={() => setLastResult(null)}
                className="mt-1 text-[11px] text-muted-foreground hover:text-foreground underline"
              >
                Dismiss
              </button>
            </div>
          )}
        </div>
      )}

      {members.length === 0 ? (
        <div className="bg-card rounded-xl border border-border shadow-sahara">
          <EmptyState icon="group" title="No members yet" description="Add employees to give them access to this workspace's knowledge." />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {members.map((m) => (
            <div
              key={m.employee_id}
              className="bg-card rounded-xl border border-border shadow-sahara p-4 flex items-start gap-3 group hover:border-primary/20 transition-all"
            >
              <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-primary text-sm">person</span>
              </div>
              <div className="flex flex-col flex-1 min-w-0">
                <span className="text-sm font-medium truncate">{m.employee_name}</span>
                <span className="text-xs text-muted-foreground truncate">{m.employee_email}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger render={<div className="relative cursor-help" />}>
                        {isAdmin ? (
                          <Select
                            value={m.role}
                            onValueChange={(val) => { if (val) handleUpdateRole(m.employee_id, val) }}
                            disabled={updatingRoleFor === m.employee_id}
                          >
                            <SelectTrigger className="h-6 rounded-full border border-border px-2.5 py-0.5 text-xs font-semibold capitalize bg-transparent shadow-sm focus:ring-0 w-auto min-w-[90px]">
                              {updatingRoleFor === m.employee_id ? (
                                <span className="material-symbols-outlined text-[14px] animate-spin mx-auto">progress_activity</span>
                              ) : (
                                <SelectValue placeholder={m.role} />
                              )}
                            </SelectTrigger>
                            <SelectContent side="bottom" align="end" alignItemWithTrigger={false} className="w-[480px]">
                              {Object.entries(ROLE_DESCRIPTIONS).map(([role, lines]) => (
                                <SelectItem key={role} value={role} className="whitespace-normal items-start p-3">
                                  <div className="flex flex-col text-left w-full pr-2">
                                    <span className="font-medium capitalize mb-1.5">{role}</span>
                                    <ul className="list-disc pl-3.5 text-[11px] text-muted-foreground space-y-1">
                                      {lines.map((line, i) => (
                                        <li key={i}>{line}</li>
                                      ))}
                                    </ul>
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Badge variant="outline" className="text-xs capitalize">{m.role}</Badge>
                        )}
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[480px] text-left p-3.5">
                      <div className="flex flex-col">
                        <span className="font-semibold capitalize mb-1.5 border-b border-background/20 pb-1.5">{m.role}</span>
                        <ul className="list-disc pl-4 text-[11px] opacity-90 space-y-1 mt-1.5">
                          {(ROLE_DESCRIPTIONS[m.role as keyof typeof ROLE_DESCRIPTIONS] || []).map((line, i) => (
                            <li key={i}>{line}</li>
                          ))}
                        </ul>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                {isAdmin && (
                  <button
                    onClick={() => handleRemoveMember(m.employee_id)}
                    className="text-muted-foreground hover:text-destructive transition-colors opacity-0 group-hover:opacity-100"
                  >
                    <span className="material-symbols-outlined text-base">close</span>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
