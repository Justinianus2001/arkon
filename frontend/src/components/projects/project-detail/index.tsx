"use client";

import React, { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { WikiPageSummary } from "@/types/wiki";

import { Project, Member, ProjectSource, Employee, Source } from "./types";
import { MembersTab } from "./members-tab";
import { SourcesTab } from "./sources-tab";
import { WikiTab } from "./wiki-tab";

type Props = {
  project: Project;
  isAdmin: boolean;
  onBack: () => void;
};

export function ProjectDetail({ project, isAdmin, onBack }: Props) {
  const { getWorkspaceRole } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [sources, setSources] = useState<ProjectSource[]>([]);
  const [allEmployees, setAllEmployees] = useState<Employee[]>([]);
  const [allSources, setAllSources] = useState<Source[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"wiki" | "sources" | "members">("wiki");
  const [wikiPages, setWikiPages] = useState<WikiPageSummary[]>([]);
  const [wikiLoading, setWikiLoading] = useState(false);
  const [wikiIndexMd, setWikiIndexMd] = useState<string | null>(null);

  // Workspace-level admin: either an org admin or someone explicitly given
  // the workspace `admin` role. The candidate-picker endpoints are scoped to
  // this, not org-level `org:employees:read`.
  const workspaceRole = getWorkspaceRole(project.id);
  const canAdminWorkspace = isAdmin || workspaceRole === "admin";
  const canEditWorkspace =
    canAdminWorkspace || workspaceRole === "editor";

  const load = useCallback(async () => {
    // Members + sources of THIS workspace — any workspace member can read.
    // Candidate lists — gated by workspace role (admin for members, editor+
    // for sources). Use allSettled so a 403 on a candidate fetch (viewer
    // opens the page) doesn't sink the whole load.
    const [mRes, sRes, empRes, srcRes] = await Promise.allSettled([
      api<Member[]>(`/api/projects/${project.id}/members`),
      api<ProjectSource[]>(`/api/projects/${project.id}/sources`),
      canAdminWorkspace
        ? api<Employee[]>(`/api/projects/${project.id}/members/candidates?limit=500`)
        : Promise.resolve([] as Employee[]),
      canEditWorkspace
        ? api<Source[]>(`/api/projects/${project.id}/sources/candidates?limit=500`)
        : Promise.resolve([] as Source[]),
    ]);

    if (mRes.status === "fulfilled") setMembers(mRes.value);
    if (sRes.status === "fulfilled") setSources(sRes.value);
    if (empRes.status === "fulfilled") setAllEmployees(empRes.value || []);
    if (srcRes.status === "fulfilled") setAllSources(srcRes.value || []);

    // Only surface an error when the CORE lists fail — partial failure of
    // candidate pickers is normal for non-admin viewers and would be
    // confusing to flag as "Failed to load project details".
    if (mRes.status === "rejected" || sRes.status === "rejected") {
      console.error("Project core load failed", mRes, sRes);
      setError("Failed to load project details");
    } else {
      setError(null);
    }
  }, [project.id, canAdminWorkspace, canEditWorkspace]);

  const loadWiki = useCallback(async () => {
    setWikiLoading(true);
    try {
      const pages = await api<WikiPageSummary[]>(`/api/projects/${project.id}/wiki?limit=200`);
      setWikiPages(pages);
      
      try {
        const idxData = await api<{ content_md: string }>(`/api/projects/${project.id}/wiki/index`);
        setWikiIndexMd(idxData.content_md);
      } catch {
        setWikiIndexMd(null);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setWikiLoading(false);
    }
  }, [project.id]);

  const loadProjectSources = useCallback(async () => {
    try {
      const s = await api<ProjectSource[]>(`/api/projects/${project.id}/sources`);
      setSources(s);
    } catch (err) {
      console.error(err);
    }
  }, [project.id]);

  useEffect(() => {
    load();
    loadWiki();
  }, [load, loadWiki]);

  // Poll for document processing status
  useEffect(() => {
    const hasPending = sources.some(s => s.status === "pending" || s.status === "processing" || s.status === "plan_ready");
    if (!hasPending) return;

    const interval = setInterval(() => {
      loadProjectSources();
      loadWiki(); // Also reload wiki pages so the count live-updates
    }, 3000);

    return () => clearInterval(interval);
  }, [sources, loadProjectSources, loadWiki]);

  // Candidate endpoints already exclude current members / linked sources, so
  // these are just direct passthroughs now. Keep the names for callsite
  // compatibility.
  const availableEmployees = allEmployees;
  const availableSources = allSources;

  const tabConfig = [
    { key: "wiki" as const, label: "Wiki", count: wikiPages.length, icon: "auto_stories" },
    { key: "sources" as const, label: "Documents", count: sources.length, icon: "description" },
    { key: "members" as const, label: "Members", count: members.length, icon: "group" },
  ];

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* 2-col header: left = back + title, right = tabs */}
      <div className="flex items-end gap-4 pb-4">
        {/* Left: back button + project identity */}
        <div className="flex items-center gap-3 pb-3 shrink-0">
          <Button variant="ghost" size="sm" onClick={onBack} className="h-8 px-2">
            <span className="material-symbols-outlined text-base">arrow_back</span>
            <span className="ml-1 text-sm">Back</span>
          </Button>
          <div className="w-px h-5 bg-border" />
          <span className="material-symbols-outlined text-primary text-lg">
            {project.workspace_type === "customer" ? "domain" : "folder_special"}
          </span>
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold font-serif leading-tight truncate max-w-[260px]">
                {project.name}
              </h1>
              <Badge
                variant="outline"
                className={project.status === "active" ? "text-green-600 border-green-300 text-xs" : "text-muted-foreground text-xs"}
              >
                {project.status}
              </Badge>
            </div>
            {project.description && (
              <p className="text-xs text-muted-foreground truncate max-w-[260px]">{project.description}</p>
            )}
          </div>
        </div>

        {/* Right: tabs flush to bottom of header row */}
        <div className="flex items-end gap-1 flex-1 justify-end">
          {tabConfig.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${tab === t.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
            >
              <span className="material-symbols-outlined text-base">{t.icon}</span>
              {t.label}
              <span className="ml-1 tabular-nums text-xs text-muted-foreground">{t.count}</span>
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mt-4 text-sm text-destructive bg-destructive/10 px-4 py-2 rounded-lg flex items-center gap-2">
          <span className="material-symbols-outlined text-base">error</span>
          {error}
        </div>
      )}

      {/* ================================================================ */}
      {/* Content Area                                                     */}
      {/* ================================================================ */}
      
      {tab === "members" && (
        <MembersTab
          project={project}
          members={members}
          isAdmin={canAdminWorkspace}
          availableEmployees={availableEmployees}
          onChanged={load}
          onError={setError}
        />
      )}

      {tab === "sources" && (
        <SourcesTab
          project={project}
          sources={sources}
          isAdmin={canEditWorkspace}
          availableSources={availableSources}
          onChanged={load}
          onError={setError}
        />
      )}

      {tab === "wiki" && (
        <WikiTab
          project={project}
          wikiPages={wikiPages}
          wikiLoading={wikiLoading}
          wikiIndexMd={wikiIndexMd}
        />
      )}
    </div>
  );
}
