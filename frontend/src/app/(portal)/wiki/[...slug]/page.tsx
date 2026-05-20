"use client";

import React from "react";
import { useParams, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { WikiPageDetail, DraftResponse } from "@/types/wiki";
import { WikiPageTree } from "@/components/wiki/wiki-page-tree";
import { WikiContent } from "@/components/wiki/wiki-content";
import { WikiSidebarRight } from "@/components/wiki/wiki-backlinks";
import { WikiEditor } from "@/components/wiki/wiki-editor";
import { WikiDraftBanner } from "@/components/wiki/wiki-draft-banner";
import { wikiTypeGroupLabel } from "@/components/wiki/wiki-type-badge";
import { WikiSearchDialog } from "@/components/wiki/wiki-search-dialog";
import { WikiScopeSwitcher } from "@/components/wiki/wiki-scope-switcher";
import { WikiCreatePageDialog } from "@/components/wiki/wiki-create-page-dialog";
import { WikiScope } from "@/types/wiki";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import Link from "next/link";

const WORKSPACE_ROLE_LEVEL: Record<string, number> = {
  viewer: 0,
  contributor: 1,
  editor: 2,
  admin: 3,
};

function roleAtLeast(role: string | null, min: string): boolean {
  if (!role) return false;
  return (WORKSPACE_ROLE_LEVEL[role] ?? -1) >= (WORKSPACE_ROLE_LEVEL[min] ?? 999);
}

export default function WikiPageViewer() {
  const params = useParams();
  const searchParams = useSearchParams();
  const { user, getWorkspaceRole, hasPermission } = useAuth();

  const slugParts = Array.isArray(params.slug) ? params.slug : [params.slug ?? ""];
  const fullSlug = slugParts.join("/");
  const scopeType = searchParams.get("scopeType") || undefined;
  const scopeId = searchParams.get("scopeId") || undefined;
  const isScoped = !!scopeType && scopeType !== "global";
  const isProjectScoped = isScoped && scopeType === "project";

  // Where "back" navigates. Projects keep their dedicated workspace page;
  // department-scoped pages return to the wiki landing with the scope preserved
  // so the user lands back on that department's tree+index, not global.
  const backHref = isProjectScoped
    ? "/workspaces"
    : isScoped
      ? `/wiki?scope_type=${scopeType}&scope_id=${scopeId}`
      : "/wiki";

  // Suffix appended to in-page wiki links (backlinks, outlinks, [[wikilinks]])
  // so navigation between related pages keeps the current scope context.
  const scopeLinkSuffix = isScoped
    ? `?scopeType=${scopeType}&scopeId=${scopeId}`
    : "";

  // Look up the display name for the current page's scope so the scope
  // switcher trigger reads e.g. "Phòng Nhân sự" rather than just "department".
  const [scopes, setScopes] = React.useState<WikiScope[]>([]);
  React.useEffect(() => {
    api<WikiScope[]>("/api/wiki/my-scopes")
      .then((s) => setScopes(Array.isArray(s) ? s : []))
      .catch(() => setScopes([]));
  }, []);
  const currentScope: WikiScope = React.useMemo(() => {
    if (isScoped && scopeType && scopeId) {
      const match = scopes.find(
        (s) => s.scope_type === scopeType && s.scope_id === scopeId,
      );
      if (match) return match;
      return { scope_type: scopeType, scope_id: scopeId, name: scopeType };
    }
    return { scope_type: "global", scope_id: null, name: "Global" };
  }, [isScoped, scopeType, scopeId, scopes]);

  const [page, setPage] = React.useState<WikiPageDetail | null>(null);
  const [notFound, setNotFound] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [dialogScope, setDialogScope] = React.useState<WikiScope | null>(null);
  // Author-side: the draft the user is currently resubmitting (needs_revision).
  // When set, the page replaces the read view with a WikiEditor pre-filled
  // with the draft's previous content.
  const [editingDraft, setEditingDraft] = React.useState<DraftResponse | null>(null);

  // Edit mode
  const [mode, setMode] = React.useState<"view" | "edit">("view");

  // Pending drafts (for editors/admins)
  const [drafts, setDrafts] = React.useState<DraftResponse[]>([]);

  // ---------------------------------------------------------------------------
  // Permission helpers
  // ---------------------------------------------------------------------------
  // Workspace role only applies to project-scoped pages — getWorkspaceRole
  // looks up project memberships and returns null for department scope IDs.
  const wsRole = isProjectScoped && scopeId ? getWorkspaceRole(scopeId) : null;
  const isGlobalAdmin = user?.role === "admin";
  const isDeptScoped = scopeType === "department";
  const isOwnDept =
    isDeptScoped && !!scopeId && !!user?.department_id && user.department_id === scopeId;

  // Can directly edit (PUT /wiki/pages/{slug}). Department-scoped pages
  // require wiki:write:all — own_dept only grants propose access.
  const canEdit: boolean = (() => {
    if (!user) return false;
    if (isGlobalAdmin) return true;
    if (isProjectScoped) return roleAtLeast(wsRole, "editor");
    return hasPermission("wiki:write:all");
  })();

  // Can propose draft (POST /wiki/pages/{slug}/drafts).
  // - Project: workspace contributor+
  // - Department: own_dept perm AND the page is in user's department, OR write:all
  // - Global: any wiki:write permission
  const canPropose: boolean = (() => {
    if (!user) return false;
    if (canEdit) return true; // editors can always propose
    if (isProjectScoped) return roleAtLeast(wsRole, "contributor");
    if (isDeptScoped) {
      if (hasPermission("wiki:write:all")) return true;
      return hasPermission("wiki:write:own_dept") && isOwnDept;
    }
    // Global
    return hasPermission("wiki:write:own_dept") || hasPermission("wiki:write:all");
  })();

  // Can review drafts
  const canReview: boolean = canEdit;

  // Permission helper for the create-page action — mirrors the helper on
  // /wiki landing so the dialog mode follows whatever scope is chosen.
  const getCreateModeForScope = React.useCallback(
    (scope: { scope_type: string; scope_id: string | null }): "direct" | "propose" | null => {
      if (!user) return null;
      const st = scope.scope_type;
      const sid = scope.scope_id;
      if (st === "project" && sid) {
        const role = getWorkspaceRole(sid);
        if (isGlobalAdmin || roleAtLeast(role, "editor")) return "direct";
        if (roleAtLeast(role, "contributor")) return "propose";
        return null;
      }
      if (st === "department" && sid) {
        if (isGlobalAdmin || hasPermission("wiki:write:all")) return "direct";
        if (hasPermission("wiki:write:own_dept") && user.department_id === sid) {
          return "propose";
        }
        return null;
      }
      if (isGlobalAdmin || hasPermission("wiki:write:all")) return "direct";
      if (hasPermission("wiki:write:own_dept")) return "propose";
      return null;
    },
    [user, isGlobalAdmin, getWorkspaceRole, hasPermission],
  );
  const headerCreateMode = getCreateModeForScope({
    scope_type: currentScope.scope_type,
    scope_id: currentScope.scope_id ?? null,
  });
  const dialogTargetScope = dialogScope ?? currentScope;
  const dialogMode = getCreateModeForScope({
    scope_type: dialogTargetScope.scope_type,
    scope_id: dialogTargetScope.scope_id ?? null,
  });

  // ---------------------------------------------------------------------------
  // Load page
  // ---------------------------------------------------------------------------
  React.useEffect(() => {
    if (!fullSlug) return;
    setLoading(true);
    setNotFound(false);
    setPage(null);
    setMode("view");

    const scopeParams = isScoped ? `?scope_type=${scopeType}&scope_id=${scopeId}` : "";
    api<WikiPageDetail>(`/api/wiki/pages/${encodeURIComponent(fullSlug)}${scopeParams}`)
      .then((data) => setPage(data))
      .catch((err) => {
        if (err?.status === 404 || err?.message?.includes("404")) {
          setNotFound(true);
        }
      })
      .finally(() => setLoading(false));
  }, [fullSlug, scopeType, scopeId, isScoped]);

  // ---------------------------------------------------------------------------
  // Load pending drafts (editors/admins only, after page loaded)
  // ---------------------------------------------------------------------------
  const fetchDrafts = React.useCallback(() => {
    if (!page) return;
    // Backend returns reviewable drafts to reviewers and author-only drafts
    // to everyone else — so the same fetch surfaces 'your pending draft'
    // even when the user is not a reviewer of this page.
    api<DraftResponse[]>(
      `/api/wiki/pages/${encodeURIComponent(fullSlug)}/drafts${isScoped ? `?scope_type=${scopeType}&scope_id=${scopeId}` : ""}`
    )
      .then((data) =>
        setDrafts(
          data.filter((d) => d.status === "pending" || d.status === "needs_revision"),
        ),
      )
      .catch(() => setDrafts([]));
  }, [page, fullSlug, isScoped, scopeType, scopeId]);

  React.useEffect(() => {
    fetchDrafts();
  }, [fetchDrafts]);

  // ---------------------------------------------------------------------------
  // Keyboard shortcut: ⌘K search
  // ---------------------------------------------------------------------------
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // ---------------------------------------------------------------------------
  // Save handlers
  // ---------------------------------------------------------------------------
  const handleSaveEdit = async (content: string, note: string) => {
    // Direct edit endpoint reads scope from query params (it accepts them via
    // FastAPI Query). Pass both via the URL so the backend resolves the page
    // in the correct scope even when the same slug exists elsewhere.
    const scopeParams = isScoped ? `?scope_type=${scopeType}&scope_id=${scopeId}` : "";
    const updated = await api<WikiPageDetail>(
      `/api/wiki/pages/${encodeURIComponent(fullSlug)}${scopeParams}`,
      {
        method: "PUT",
        body: { content_md: content, change_note: note || undefined },
      }
    );
    setPage(updated);
    setMode("view");
  };

  const handleSaveProposal = async (content: string, note: string) => {
    // propose_draft reads scope from the JSON body (Pydantic model, not Query).
    // Sending the params via query did nothing — backend fell through to
    // get_page_by_slug_any_scope, attaching the draft to whichever scope's
    // copy of the slug happened to be returned first.
    await api(
      `/api/wiki/pages/${encodeURIComponent(fullSlug)}/drafts`,
      {
        method: "POST",
        body: {
          content_md: content,
          note: note || undefined,
          scope_type: isScoped ? scopeType : "global",
          scope_id: isScoped ? scopeId : undefined,
          base_version: page?.version,
        },
      }
    );
    setMode("view");
  };

  const handleDraftApproved = (draftId: string) => {
    setDrafts((prev) => prev.filter((d) => d.id !== draftId));
    // Reload page content — the approved draft has been applied
    const scopeParams = isScoped ? `?scope_type=${scopeType}&scope_id=${scopeId}` : "";
    api<WikiPageDetail>(`/api/wiki/pages/${encodeURIComponent(fullSlug)}${scopeParams}`)
      .then(setPage)
      .catch(() => {});
  };

  const handleDraftRejected = (draftId: string) => {
    setDrafts((prev) => prev.filter((d) => d.id !== draftId));
  };

  const handleDraftWithdrawn = (draftId: string) => {
    setDrafts((prev) => prev.filter((d) => d.id !== draftId));
  };

  const handleResubmitOpen = (draft: DraftResponse) => {
    setEditingDraft(draft);
  };

  const handleResubmitSave = async (content: string, note: string) => {
    if (!editingDraft) return;
    await api(`/api/wiki/drafts/${editingDraft.id}/content`, {
      method: "PATCH",
      body: { content_md: content, note: note || undefined },
    });
    setEditingDraft(null);
    // Refresh draft list so the banner shows the new pending status.
    fetchDrafts();
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <>
      <PageHeader
        title="Knowledge Wiki"
        description="Compiled knowledge from your organization's documents."
        action={
          <div className="flex items-center gap-2">
            <WikiScopeSwitcher current={currentScope} />
            <Button
              variant="outline"
              onClick={() => setSearchOpen(true)}
              className="gap-2"
            >
              <span className="material-symbols-outlined text-base">search</span>
              Search
              <kbd className="hidden sm:inline-block ml-1 px-1.5 py-0.5 rounded border border-border text-xs font-mono text-muted-foreground">
                ⌘K
              </kbd>
            </Button>
            {headerCreateMode && (
              <Button
                variant="outline"
                onClick={() => {
                  setDialogScope(null);
                  setCreateOpen(true);
                }}
                className="gap-2"
                title={
                  headerCreateMode === "direct"
                    ? `Create a new page in ${currentScope.name}`
                    : `Propose a new page in ${currentScope.name} (reviewer approves)`
                }
              >
                <span className="material-symbols-outlined text-base">add</span>
                {headerCreateMode === "direct" ? "New page" : "Propose page"}
              </Button>
            )}
            {user && (
              <Link
                href="/wiki/queue"
                className="inline-flex h-8 items-center gap-1.5 px-2.5 rounded-lg text-sm font-medium border border-border bg-background hover:bg-muted transition-colors"
                title="Drafts you authored and drafts waiting for your review"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>edit_note</span>
                Contributions
              </Link>
            )}
            <Link
              href="/wiki/graph"
              className="inline-flex h-8 items-center gap-1.5 px-2.5 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>hub</span>
              Graph View
            </Link>
          </div>
        }
      />

      <div className="flex-1 flex gap-0 -mx-6 md:-mx-8 lg:-mx-10 -mb-6 md:-mb-8 lg:-mb-10 min-h-0 border-t border-border overflow-hidden">
        {/* Left: Page Tree — same scope-grouped layout as /wiki. We do NOT
            filter pagesUrl by scope so the sidebar is identical across all
            wiki pages; the active page's scope bucket auto-expands. */}
        <WikiPageTree
          activeSlug={fullSlug}
          groupByScope
          activeScope={{
            scope_type: scopeType ?? "global",
            scope_id: scopeId ?? null,
          }}
          getCreateModeForScope={getCreateModeForScope}
          onCreatePage={(scope) => {
            const match = scopes.find(
              (s) =>
                s.scope_type === scope.scope_type &&
                (s.scope_id ?? null) === (scope.scope_id ?? null),
            );
            setDialogScope(
              match ?? {
                scope_type: scope.scope_type,
                scope_id: scope.scope_id,
                name: scope.scope_type,
              },
            );
            setCreateOpen(true);
          }}
        />

        {/* Center: Content */}
        <div className="flex-1 overflow-y-auto min-w-0">
          {loading ? (
            <div className="max-w-3xl mx-auto px-8 py-8">
              <div className="flex items-center gap-2 mb-4">
                <div className="h-4 w-16 rounded bg-muted animate-pulse" />
                <div className="h-4 w-4 text-muted-foreground">/</div>
                <div className="h-4 w-24 rounded bg-muted animate-pulse" />
              </div>
              <div className="h-10 w-2/3 rounded-lg bg-muted animate-pulse mb-3" />
              <div className="h-4 w-full rounded bg-muted animate-pulse mb-2" />
              <div className="h-4 w-5/6 rounded bg-muted animate-pulse mb-8" />
              <div className="space-y-3">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-4 rounded bg-muted animate-pulse"
                    style={{ width: `${85 - i * 5}%`, opacity: 1 - i * 0.08 }}
                  />
                ))}
              </div>
            </div>
          ) : notFound ? (
            <div className="px-8 py-12">
              <EmptyState
                icon="find_in_page"
                title="Page not found"
                description={`No wiki page found for "${fullSlug}". It may not have been compiled yet.`}
              />
            </div>
          ) : page ? (
            <div className="max-w-3xl mx-auto px-8 py-8">
              {/* Breadcrumb & Back Button — project scope returns to /workspaces,
                  department scope returns to /wiki with that department's scope
                  preserved so the user lands on the dept's tree+index. */}
              <div className="flex items-center gap-3 mb-6">
                <Link
                  href={backHref}
                  className="flex items-center justify-center w-8 h-8 rounded-full border border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground transition-colors shrink-0 shadow-sm"
                  title={isProjectScoped ? "Back to Workspace" : "Back to Wiki"}
                >
                  <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                </Link>

                <nav className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Link
                    href={backHref}
                    className="hover:text-foreground transition-colors font-medium"
                  >
                    {isProjectScoped ? "Workspace" : "Wiki"}
                  </Link>
                  <span className="material-symbols-outlined text-muted-foreground/50" style={{ fontSize: 14 }}>chevron_right</span>
                  <span className="capitalize font-medium">
                    {wikiTypeGroupLabel(page.page_type)}
                  </span>
                  <span className="material-symbols-outlined text-muted-foreground/50" style={{ fontSize: 14 }}>chevron_right</span>
                  <span className="text-foreground font-semibold truncate max-w-[200px]">
                    {page.title}
                  </span>
                </nav>
              </div>

              {/* Page header + Edit button */}
              <div className="flex items-start justify-between gap-4 mb-8">
                <div className="flex-1 min-w-0">
                  <h1 className="font-heading text-4xl font-normal leading-tight text-foreground">
                    {page.title}
                  </h1>
                </div>

                {mode === "view" && (canEdit || canPropose) && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setMode("edit")}
                    className="shrink-0 gap-1.5 mt-1"
                  >
                    <span className="material-symbols-outlined text-sm">edit</span>
                    {canEdit ? "Edit" : "Propose Edit"}
                  </Button>
                )}
              </div>

              {/* Draft banner — visible to reviewers AND to authors of own drafts. */}
              {mode === "view" && !editingDraft && drafts.length > 0 && (
                <div className="mb-6">
                  <WikiDraftBanner
                    drafts={drafts}
                    currentContent={page.content_md}
                    currentUserId={user?.id ?? null}
                    onApproved={handleDraftApproved}
                    onRejected={handleDraftRejected}
                    onResubmitDraft={handleResubmitOpen}
                    onWithdrawn={handleDraftWithdrawn}
                  />
                </div>
              )}

              {/* Markdown body / direct-edit / resubmit-draft editor */}
              {editingDraft ? (
                <WikiEditor
                  initialContent={editingDraft.content_md}
                  noteLabel="Resubmission note"
                  notePlaceholder="What changed in this round?"
                  saveLabel="Resubmit draft"
                  onSave={handleResubmitSave}
                  onCancel={() => setEditingDraft(null)}
                />
              ) : mode === "edit" ? (
                <WikiEditor
                  initialContent={page.content_md}
                  noteLabel={canEdit ? "Change note" : "Proposal note"}
                  notePlaceholder={
                    canEdit
                      ? "Briefly describe what you changed (optional)"
                      : "Describe your proposed change (optional)"
                  }
                  saveLabel={canEdit ? "Save Edit" : "Submit Proposal"}
                  onSave={canEdit ? handleSaveEdit : handleSaveProposal}
                  onCancel={() => setMode("view")}
                />
              ) : (
                <WikiContent markdown={page.content_md} linkSuffix={scopeLinkSuffix} />
              )}
            </div>
          ) : null}
        </div>

        {/* Right: Sidebar (hidden on < lg, only in view mode) */}
        {page && mode === "view" && (
          <div className="hidden lg:block h-full">
            <WikiSidebarRight slug={fullSlug} page={page} linkSuffix={scopeLinkSuffix} />
          </div>
        )}
      </div>

      <WikiSearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
      {dialogMode && (
        <WikiCreatePageDialog
          open={createOpen}
          onOpenChange={(o) => {
            setCreateOpen(o);
            if (!o) setDialogScope(null);
          }}
          mode={dialogMode}
          defaultScope={dialogTargetScope}
          scopes={scopes}
          getCreateModeForScope={(s) =>
            getCreateModeForScope({
              scope_type: s.scope_type,
              scope_id: s.scope_id ?? null,
            })
          }
        />
      )}
    </>
  );
}
