"use client";

import React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { DraftResponse } from "@/types/wiki";
import { Button } from "@/components/ui/button";

export default function WikiBranchRebasePage() {
  const params = useParams();
  const router = useRouter();
  const branchId = params.id as string;

  const [branch, setBranch] = React.useState<any | null>(null);
  const [drafts, setDrafts] = React.useState<DraftResponse[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Rebase workspace states
  const [selectedDraft, setSelectedDraft] = React.useState<DraftResponse | null>(null);
  const [mainContent, setMainContent] = React.useState<string>("");
  const [mainContentLoading, setMainContentLoading] = React.useState(false);
  const [resolvedContent, setResolvedContent] = React.useState<string>("");

  const loadBranch = React.useCallback(async () => {
    setLoading(true);
    try {
      const b = await api<any>(`/api/wiki/branches/${branchId}`);
      setBranch(b);
      const allDrafts = b.drafts || [];
      setDrafts(allDrafts);

      // Default to first conflicting draft
      const conflictDraft = allDrafts.find((d: any) => d.has_conflict);
      if (conflictDraft) {
        setSelectedDraft(conflictDraft);
      } else if (allDrafts.length > 0) {
        setSelectedDraft(allDrafts[0]);
      }
    } catch {
      router.push("/wiki/review?mine=true");
    } finally {
      setLoading(false);
    }
  }, [branchId, router]);

  React.useEffect(() => {
    loadBranch();
  }, [loadBranch]);

  // Load the current live content of the main page in conflict
  React.useEffect(() => {
    if (!selectedDraft || !selectedDraft.page_slug || selectedDraft.draft_kind === "create") {
      setMainContent("");
      setResolvedContent("");
      return;
    }
    setMainContentLoading(true);
    const qs = new URLSearchParams();
    if (selectedDraft.page_scope_type) qs.set("scope_type", selectedDraft.page_scope_type);
    if (selectedDraft.page_scope_id) qs.set("scope_id", selectedDraft.page_scope_id);
    api<{ content_md?: string }>(`/api/wiki/pages/${selectedDraft.page_slug}?${qs.toString()}`)
      .then((p) => {
        const live = p?.content_md || "";
        setMainContent(live);

        // Pre-fill resolved workspace with conflict markers or live content as helper
        if (selectedDraft.has_conflict) {
          setResolvedContent(
            `<<<<<<< MAIN WIKI (Phiên bản mới nhất)\n${live}\n=======\n${selectedDraft.content_md}\n>>>>>>> NHÁNH CỦA BẠN (Bản thay đổi)`
          );
        } else {
          setResolvedContent(selectedDraft.content_md);
        }
      })
      .catch(() => {
        setMainContent("");
        setResolvedContent(selectedDraft.content_md);
      })
      .finally(() => {
        setMainContentLoading(false);
      });
  }, [selectedDraft]);

  const handleResolve = async () => {
    if (!branch || !selectedDraft) return;
    setBusy(true);
    setError(null);
    try {
      await api(
        `/api/wiki/branches/${branch.id}/rebase/${selectedDraft.id}`,
        {
          method: "POST",
          body: { resolved_content_md: resolvedContent },
        }
      );
      // Reload branch details
      await loadBranch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Xử lý xung đột thất bại");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <p className="text-sm text-muted-foreground italic">Đang tải thông tin nhánh đóng góp…</p>
      </div>
    );
  }

  const conflictingDrafts = drafts.filter((d) => d.has_conflict);

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Top Header */}
      <header className="border-b border-border px-6 py-4 flex items-center justify-between bg-card/40">
        <div>
          <div className="flex items-center gap-2">
            <Link
              href="/wiki/review?mine=true"
              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-[14px]">arrow_back</span>
              Quay lại danh sách nháp
            </Link>
          </div>
          <h1 className="text-base font-semibold mt-1 flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 font-medium">
              Giải quyết xung đột
            </span>
            <span>{branch?.name}</span>
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5 font-mono">ID Nhánh: {branchId}</p>
        </div>

        {conflictingDrafts.length === 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1 font-medium flex items-center gap-1">
              <span className="material-symbols-outlined text-sm">check_circle</span>
              Đã xử lý hết xung đột!
            </span>
            <Link href={`/wiki/review?mine=true&draft=${branchId}`}>
              <Button size="sm">Gửi duyệt hợp nhất</Button>
            </Link>
          </div>
        )}
      </header>

      {/* Main Layout Workspace */}
      <div className="flex-1 min-h-0 grid grid-cols-[260px_1fr] gap-0">
        {/* Left Sidebar: List of files changed in branch */}
        <aside className="border-r border-border bg-card/20 flex flex-col min-h-0">
          <div className="p-3 border-b border-border">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Danh sách tập tin</h2>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {drafts.map((d) => (
              <button
                key={d.id}
                onClick={() => setSelectedDraft(d)}
                className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-all flex items-center gap-2 ${
                  selectedDraft?.id === d.id
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
              >
                <span className="material-symbols-outlined text-[14px]">
                  {d.draft_kind === "create" ? "add_box" : "description"}
                </span>
                <span className="truncate flex-1">{d.page_title || d.page_slug}</span>
                {d.has_conflict && (
                  <span className="w-1.5 h-1.5 rounded-full bg-destructive animate-pulse" title="Có xung đột" />
                )}
              </button>
            ))}
          </div>
        </aside>

        {/* Center Panel Workspace: 3-pane Workspace */}
        {selectedDraft ? (
          <div className="flex flex-col min-h-0">
            {/* Header of selected file conflict */}
            <div className="border-b border-border px-6 py-3 flex items-center justify-between bg-card/10">
              <div>
                <h3 className="text-sm font-semibold text-foreground">{selectedDraft.page_title || selectedDraft.page_slug}</h3>
                <p className="text-[11px] text-muted-foreground font-mono mt-0.5">{selectedDraft.page_slug}</p>
              </div>
              {selectedDraft.has_conflict ? (
                <span className="text-[10px] text-rose-600 bg-rose-50 border border-rose-100 px-2 py-0.5 rounded-full font-medium">
                  Đang có xung đột (base v{selectedDraft.base_version} vs main v{selectedDraft.page_version})
                </span>
              ) : (
                <span className="text-[10px] text-emerald-600 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-full font-medium">
                  Không có xung đột
                </span>
              )}
            </div>

            {/* The 3 Columns */}
            <div className="flex-1 min-h-0 grid grid-cols-3 gap-0 divide-x divide-border">
              {/* Col 1: Live Main Wiki Content */}
              <div className="flex flex-col min-h-0 p-4 space-y-2">
                <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">1. Bản trên Main Wiki</h4>
                {mainContentLoading ? (
                  <p className="text-xs text-muted-foreground italic">Đang tải trang chính…</p>
                ) : (
                  <pre className="flex-1 overflow-auto p-3 rounded-lg border bg-muted/30 text-xs font-mono whitespace-pre-wrap">
                    {mainContent || "_(Trang trống)_"}
                  </pre>
                )}
              </div>

              {/* Col 2: Your proposed changes */}
              <div className="flex flex-col min-h-0 p-4 space-y-2">
                <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">2. Bản nháp của bạn</h4>
                <pre className="flex-1 overflow-auto p-3 rounded-lg border bg-muted/30 text-xs font-mono whitespace-pre-wrap">
                  {selectedDraft.content_md || "_(Trang nháp trống)_"}
                </pre>
              </div>

              {/* Col 3: Resolution Workspace Editor */}
              <div className="flex flex-col min-h-0 p-4 space-y-2">
                <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-primary">3. Kết quả hợp nhất (Kết quả sửa đổi)</h4>
                <textarea
                  value={resolvedContent}
                  onChange={(e) => setResolvedContent(e.target.value)}
                  className="flex-1 p-3 rounded-lg border border-input bg-background text-xs font-mono outline-none focus:border-primary resize-none text-foreground"
                  placeholder="Hợp nhất thủ công nội dung tại đây..."
                />
                {error && <p className="text-xs text-destructive">{error}</p>}
                <Button
                  onClick={handleResolve}
                  disabled={busy || !selectedDraft.has_conflict}
                  className="w-full justify-center"
                >
                  {busy ? "Đang xử lý…" : "Xác nhận giải quyết xung đột"}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center p-8">
            <p className="text-sm text-muted-foreground italic">Vui lòng chọn tập tin để xử lý.</p>
          </div>
        )}
      </div>
    </div>
  );
}
