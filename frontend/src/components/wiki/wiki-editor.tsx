"use client";

import React from "react";
import { MarkdownEditor } from "./markdown-editor";
import { Button } from "@/components/ui/button";

export type WikiEditorProps = {
  initialContent: string;
  /** Label shown above the note field */
  noteLabel: string;
  notePlaceholder?: string;
  saveLabel: string;
  onSave: (content: string, note: string) => Promise<void>;
  onCancel: () => void;
};

export function WikiEditor({
  initialContent,
  noteLabel,
  notePlaceholder,
  saveLabel,
  onSave,
  onCancel,
}: WikiEditorProps) {
  const [content, setContent] = React.useState(initialContent);
  const [note, setNote] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleSave = async () => {
    if (!content.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(content, note);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border overflow-hidden shadow-sahara">
      <MarkdownEditor value={content} onChange={setContent} />

      {/* Note field + actions */}
      <div className="flex flex-col gap-3 px-4 py-3 bg-card border-t border-border">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">{noteLabel}</label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={notePlaceholder ?? "Optional — describe what you changed"}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-muted-foreground"
          />
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || !content.trim()}
            className="gap-1.5"
          >
            {saving ? (
              <>
                <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
                Saving…
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-sm">save</span>
                {saveLabel}
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
