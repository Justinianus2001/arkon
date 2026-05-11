"use client";

import React from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Source } from "./types";

type PlanPage = {
  action: "CREATE" | "UPDATE";
  slug: string;
  title: string;
  page_type: string;
  entity_names?: string[];
  priority?: number;
  related_kb_pages?: string[];
};

type Plan = {
  pages: PlanPage[];
  strategy?: string;
};

export function PlanReviewDialog({
  source,
  onClose,
  onDone,
}: {
  source: Source;
  onClose: () => void;
  onDone: () => void;
}) {
  const [plan, setPlan] = React.useState<Plan | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState<"approve" | "reject" | null>(null);
  const [rejectNote, setRejectNote] = React.useState("");
  const [confirmReject, setConfirmReject] = React.useState(false);

  React.useEffect(() => {
    api<Plan>(`/api/sources/${source.id}/plan`)
      .then(setPlan)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load plan"))
      .finally(() => setLoading(false));
  }, [source.id]);

  const handleApprove = async () => {
    setSubmitting("approve");
    setError(null);
    try {
      await api(`/api/sources/${source.id}/plan/approve`, {
        method: "POST",
        body: { note: "Approved via UI" },
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to approve plan");
      setSubmitting(null);
    }
  };

  const handleReject = async () => {
    if (!confirmReject) {
      setConfirmReject(true);
      return;
    }
    setSubmitting("reject");
    setError(null);
    try {
      await api(`/api/sources/${source.id}/plan/reject`, {
        method: "POST",
        body: { note: rejectNote || "Rejected via UI" },
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reject plan");
      setSubmitting(null);
    }
  };

  const creates = plan?.pages.filter((p) => p.action === "CREATE") ?? [];
  const updates = plan?.pages.filter((p) => p.action === "UPDATE") ?? [];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="material-symbols-outlined text-blue-500" style={{ fontSize: 20 }}>
              fact_check
            </span>
            Review Compilation Plan
          </DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">
            {source.title} — approve to start writing wiki pages, or reject to stop.
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0 mt-2">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <span className="material-symbols-outlined animate-spin text-muted-foreground text-3xl">
                progress_activity
              </span>
            </div>
          )}

          {error && (
            <div className="text-sm text-destructive bg-destructive/10 px-4 py-2 rounded-lg mb-4">
              {error}
            </div>
          )}

          {plan && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-green-500" />
                  {creates.length} page{creates.length !== 1 ? "s" : ""} to create
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-yellow-500" />
                  {updates.length} page{updates.length !== 1 ? "s" : ""} to update
                </span>
                {plan.strategy && (
                  <span className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-sm">analytics</span>
                    {plan.strategy}
                  </span>
                )}
              </div>

              {[...creates, ...updates]
                .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
                .map((page) => (
                  <div
                    key={page.slug}
                    className="flex items-start gap-3 p-3 rounded-lg border border-border bg-card"
                  >
                    <Badge
                      variant="outline"
                      className={`shrink-0 text-[10px] font-medium h-5 px-1.5 ${
                        page.action === "CREATE"
                          ? "border-green-500/50 text-green-600"
                          : "border-yellow-500/50 text-yellow-600"
                      }`}
                    >
                      {page.action}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{page.title}</span>
                        <span className="text-[10px] text-muted-foreground font-mono">
                          {page.slug}
                        </span>
                        <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                          {page.page_type}
                        </Badge>
                      </div>
                      {page.entity_names && page.entity_names.length > 0 && (
                        <p className="text-[11px] text-muted-foreground mt-1 truncate">
                          {page.entity_names.slice(0, 5).join(", ")}
                          {page.entity_names.length > 5 && ` +${page.entity_names.length - 5} more`}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>

        {confirmReject && (
          <div className="mt-3 flex flex-col gap-2">
            <textarea
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              placeholder="Reason for rejection (optional)"
              className="w-full text-sm rounded-lg border border-border bg-background px-3 py-2 resize-none h-16 focus:outline-none focus:ring-2 focus:ring-destructive/30 focus:border-destructive/50"
            />
          </div>
        )}

        <div className="flex items-center justify-end gap-2 mt-4 pt-4 border-t border-border">
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={submitting !== null}
          >
            Cancel
          </Button>
          {!confirmReject ? (
            <Button
              variant="outline"
              onClick={() => setConfirmReject(true)}
              disabled={loading || submitting !== null}
              className="text-destructive border-destructive/30 hover:bg-destructive/10"
            >
              <span className="material-symbols-outlined mr-1.5" style={{ fontSize: 16 }}>close</span>
              Reject
            </Button>
          ) : (
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={submitting !== null}
            >
              {submitting === "reject" ? (
                <span className="material-symbols-outlined animate-spin mr-1.5" style={{ fontSize: 16 }}>
                  progress_activity
                </span>
              ) : (
                <span className="material-symbols-outlined mr-1.5" style={{ fontSize: 16 }}>close</span>
              )}
              Confirm Reject
            </Button>
          )}
          <Button
            onClick={handleApprove}
            disabled={loading || submitting !== null}
          >
            {submitting === "approve" ? (
              <span className="material-symbols-outlined animate-spin mr-1.5" style={{ fontSize: 16 }}>
                progress_activity
              </span>
            ) : (
              <span className="material-symbols-outlined mr-1.5" style={{ fontSize: 16 }}>check</span>
            )}
            Approve & Compile
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
