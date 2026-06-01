"use client";

import React, { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/shared/empty-state";

type Employee = {
  id: string;
  name: string;
  email: string;
  department_ids: string[];
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deptId: string;
  deptName: string;
};

export function DeptMembersDialog({ open, onOpenChange, deptId, deptName }: Props) {
  const [members, setMembers] = useState<Employee[]>([]);
  const [allEmployees, setAllEmployees] = useState<Employee[]>([]);
  const [selectedEmpId, setSelectedEmpId] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadMembers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<{ items: Employee[] }>(`/api/employees?department_id=${deptId}&page_size=200`);
      setMembers(res.items);
    } catch {
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }, [deptId]);

  useEffect(() => {
    if (!open) return;
    setError("");
    setSelectedEmpId("");
    loadMembers();
    api<{ items: Employee[] }>("/api/employees?page_size=500")
      .then((res) => setAllEmployees(res.items))
      .catch(() => {});
  }, [open, loadMembers]);

  const handleAdd = async () => {
    if (!selectedEmpId) return;
    setSaving(true);
    setError("");
    try {
      await api(`/api/employees/${selectedEmpId}/departments`, {
        method: "POST",
        body: { department_id: deptId },
      });
      setSelectedEmpId("");
      await loadMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add member");
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (empId: string) => {
    setError("");
    try {
      await api(`/api/employees/${empId}/departments/${deptId}`, {
        method: "DELETE",
      });
      await loadMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove member");
    }
  };

  const memberIds = new Set(members.map((m) => m.id));
  const available = allEmployees.filter((e) => !memberIds.has(e.id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-xl">Member Management — {deptName}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-5 mt-1">
          {error && (
            <p className="text-destructive text-sm bg-destructive/10 px-3 py-2 rounded-lg">{error}</p>
          )}

          {/* Add member */}
          <div className="flex gap-2 items-center">
            <Select value={selectedEmpId} onValueChange={(v) => setSelectedEmpId(v ?? "")}>
              <SelectTrigger className="bg-background flex-1">
                {selectedEmpId ? (
                  <span className="truncate">
                    {(() => {
                      const emp = available.find((e) => e.id === selectedEmpId);
                      return emp ? `${emp.name} — ${emp.email}` : selectedEmpId;
                    })()}
                  </span>
                ) : (
                  <SelectValue placeholder="Select employee to add..." />
                )}
              </SelectTrigger>
              <SelectContent>
                {available.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name} — {e.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              disabled={saving || !selectedEmpId}
              onClick={handleAdd}
              className="bg-primary text-primary-foreground shrink-0"
            >
              {saving
                ? <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span>
                : "Add"}
            </Button>
          </div>

          {/* Member list */}
          <div className="border border-border rounded-xl bg-card overflow-hidden">
            <div className="bg-muted/50 px-4 py-2 border-b border-border">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Current Members ({members.length})
              </h3>
            </div>

            {loading ? (
              <div className="flex justify-center py-8">
                <span className="material-symbols-outlined animate-spin text-muted-foreground">progress_activity</span>
              </div>
            ) : members.length === 0 ? (
              <div className="p-4">
                <EmptyState icon="group_off" title="No members" description="No employees are assigned to this department yet." />
              </div>
            ) : (
              <div className="flex flex-col divide-y divide-border max-h-60 overflow-y-auto">
                {members.map((m) => (
                  <div key={m.id} className="flex items-center justify-between px-4 py-3 hover:bg-secondary/20">
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">{m.name}</span>
                      <span className="text-xs text-muted-foreground">{m.email}</span>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRemove(m.id)}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label={`Remove ${m.name} from ${deptName}`}
                    >
                      <span className="material-symbols-outlined text-sm">close</span>
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Employees can belong to multiple departments. Removing them here only revokes
            this department&apos;s access — their other memberships are untouched.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
