import React from "react";
import { Source } from "./types";

export function StatusDot({ source }: { source: Source }) {
  const colors: Record<string, string> = {
    ready: "bg-green-500",
    processing: "bg-yellow-500",
    error: "bg-destructive",
    pending: "bg-muted-foreground",
    plan_ready: "bg-blue-500",
    awaiting_approval: "bg-orange-500",
  };

  const labels: Record<string, string> = {
    plan_ready: "Review Plan",
    awaiting_approval: "Review Size",
  };

  const status = source.status;
  const highlight = status === "plan_ready" || status === "awaiting_approval";

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <span className={`w-2 h-2 rounded-full ${colors[status] || colors.pending}`} />
        <span className={`text-xs capitalize ${highlight ? (status === "plan_ready" ? "text-blue-500 font-medium" : "text-orange-500 font-medium") : "text-muted-foreground"}`}>
          {labels[status] ?? status}
        </span>
        {status === "processing" && source.progress !== undefined && (
          <span className="text-xs text-muted-foreground">({source.progress}%)</span>
        )}
      </div>
      {(status === "processing" || status === "pending") && source.progress_message && (
        <span className="text-[10px] text-muted-foreground truncate max-w-[150px]" title={source.progress_message}>
          {source.progress_message}
        </span>
      )}
      {status === "error" && source.progress_message && (
        <span className="text-[10px] text-destructive truncate max-w-[150px]" title={source.progress_message}>
          {source.progress_message}
        </span>
      )}
    </div>
  );
}
