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
import { Source } from "./types";

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(0)}K`;
  return tokens.toString();
}

// Mirror of backend writer.py constants (Tier 1 values).
const BUDGET_RATIO = 0.85;
const KNOWN_CONTEXTS: { name: string; tokens: number }[] = [
  { name: "Claude 4 / Gemini 3 / GPT-5 (1M)", tokens: 1_000_000 },
  { name: "GPT-4o / GPT-4-turbo (128K)", tokens: 128_000 },
];

export function ExtractionReviewDialog({
  source,
  onClose,
  onDone,
}: {
  source: Source;
  onClose: () => void;
  onDone: () => void;
}) {
  const [submitting, setSubmitting] = React.useState<"approve" | "cancel" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = React.useState(false);

  const tokens = source.extracted_token_count ?? 0;
  const pages = source.page_count ?? 0;
  const images = source.image_count ?? 0;

  const handleApprove = async () => {
    setSubmitting("approve");
    setError(null);
    try {
      await api(`/api/sources/${source.id}/approve-extraction`, { method: "POST" });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to approve");
      setSubmitting(null);
    }
  };

  const handleCancel = async () => {
    if (!confirmCancel) {
      setConfirmCancel(true);
      return;
    }
    setSubmitting("cancel");
    setError(null);
    try {
      await api(`/api/sources/${source.id}`, { method: "DELETE" });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to cancel");
      setSubmitting(null);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="text-lg font-heading flex items-center gap-2">
            <span className="material-symbols-outlined text-orange-500">scale</span>
            Review document size
          </DialogTitle>
        </DialogHeader>

        <div className="text-sm text-muted-foreground mb-3">
          This document is larger than the auto-approve threshold.
          Review the extraction stats before spending AI tokens on ingestion.
        </div>

        <div className="rounded-xl border border-border p-4 mb-3">
          <div className="font-medium truncate mb-3">
            {source.title || source.file_name}
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <div className="text-2xl font-mono font-semibold">{formatTokens(tokens)}</div>
              <div className="text-xs text-muted-foreground">tokens</div>
            </div>
            <div>
              <div className="text-2xl font-mono font-semibold">{pages}</div>
              <div className="text-xs text-muted-foreground">pages</div>
            </div>
            <div>
              <div className="text-2xl font-mono font-semibold">{images}</div>
              <div className="text-xs text-muted-foreground">images</div>
            </div>
          </div>
        </div>

        <div className="rounded-xl bg-muted/30 p-3 mb-4 text-sm">
          <div className="font-medium mb-2">Fits in context (at 85% budget):</div>
          <div className="flex flex-col gap-1">
            {KNOWN_CONTEXTS.map((c) => {
              const budget = Math.round(c.tokens * BUDGET_RATIO);
              const fits = tokens <= budget;
              return (
                <div key={c.name} className="flex items-center gap-2">
                  <span
                    className={`material-symbols-outlined text-base ${fits ? "text-green-500" : "text-orange-500"
                      }`}
                  >
                    {fits ? "check_circle" : "warning"}
                  </span>
                  <span className="text-xs">
                    {c.name} — budget ~{formatTokens(budget)} tokens
                  </span>
                </div>
              );
            })}
          </div>
          {tokens > KNOWN_CONTEXTS[0].tokens * BUDGET_RATIO && (
            <div className="mt-2 text-xs text-muted-foreground italic">
              Multi-pass writer will split the doc across multiple LLM calls.
            </div>
          )}
        </div>

        {error && (
          <div className="mb-3 text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-lg">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={submitting !== null}
            className={confirmCancel ? "border-destructive text-destructive" : ""}
          >
            {submitting === "cancel"
              ? "Deleting…"
              : confirmCancel
                ? "Click again to confirm delete"
                : "Cancel & delete"}
          </Button>
          <Button
            onClick={handleApprove}
            disabled={submitting !== null}
          >
            {submitting === "approve" ? "Starting…" : "Approve & process"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
