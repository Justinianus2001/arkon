"use client";

import React from "react";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { ScopeBadge } from "@/components/shared/scope-badge";

type KnowledgeType = {
  id: string;
  slug: string;
  name: string;
  color: string;
};

type Department = {
  id: string;
  name: string;
};

type Source = {
  id: string;
  title: string;
  file_name?: string;
  source_type?: string;
  status: string;
  progress?: number;
  progress_message?: string;
  page_count?: number;
  wiki_page_count?: number;
  knowledge_type_id?: string;
  knowledge_type_name?: string;
  knowledge_type_color?: string;
  department_ids?: string[];
  department_names?: string[];
  contributed_by_name?: string;
  scope_type?: string;
  scope_id?: string;
  created_at: string;
  updated_at?: string;
};

type Props = {
  sources: Source[];
  types: KnowledgeType[];
  departments: Department[];
  loading: boolean;
  onRefresh: () => void;
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
  search: string;
  onSearch: (q: string) => void;
};

const fileIcons: Record<string, string> = {
  pdf: "picture_as_pdf",
  docx: "description",
  xlsx: "table_chart",
  csv: "table_chart",
  txt: "article",
  md: "article",
  pptx: "slideshow",
};

function getFileExt(source: Source): string {
  const name = source.file_name || "";
  return name.split(".").pop()?.toLowerCase() || "";
}

export function KnowledgeTable({
  sources,
  types,
  departments,
  loading,
  onRefresh,
  page,
  totalPages,
  total,
  onPageChange,
  search,
  onSearch,
}: Props) {
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [editSource, setEditSource] = React.useState<Source | null>(null);
  const [reingestingIds, setReingestingIds] = React.useState<Set<string>>(new Set());
  const [searchInput, setSearchInput] = React.useState(search);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this document? This cannot be undone.")) return;
    setActionError(null);
    try {
      await api(`/api/sources/${id}`, { method: "DELETE" });
      onRefresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  const handleReingest = async (id: string) => {
    setActionError(null);
    setReingestingIds((prev) => new Set(prev).add(id));
    try {
      await api(`/api/sources/${id}/recompile`, { method: "POST" });
      onRefresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to recompile");
    } finally {
      setReingestingIds((prev) => { const s = new Set(prev); s.delete(id); return s; });
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(searchInput);
  };

  return (
    <div className="flex flex-col gap-2">
      {actionError && (
        <div className="text-sm text-destructive bg-destructive/10 px-4 py-2 rounded-lg flex items-center gap-2 mb-2">
          <span className="material-symbols-outlined text-base">error</span>
          {actionError}
        </div>
      )}

      {/* Search bar + stats */}
      <div className="flex items-center justify-between mb-2">
        <form onSubmit={handleSearchSubmit} className="flex items-center gap-2">
          <div className="relative">
            <span className="material-symbols-outlined text-sm text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2">
              search
            </span>
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search documents..."
              className="h-9 pl-9 pr-3 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 w-[260px] placeholder:text-muted-foreground/60"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => { setSearchInput(""); onSearch(""); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            )}
          </div>
        </form>
        <span className="text-xs text-muted-foreground tabular-nums">
          {total} document{total !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table */}
      <div className="bg-card rounded-xl border border-border shadow-sahara overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <span className="material-symbols-outlined text-3xl text-muted-foreground animate-spin">
              progress_activity
            </span>
          </div>
        ) : sources.length === 0 ? (
          <EmptyState
            icon="cloud_upload"
            title={search ? "No results found" : "No documents found"}
            description={search ? `No documents matching "${search}"` : "Upload documents to start building your knowledge base."}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">Document</TableHead>
                <TableHead className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">Category</TableHead>
                <TableHead className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">Visibility</TableHead>
                <TableHead className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">Department</TableHead>
                <TableHead className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">Pages</TableHead>
                <TableHead className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">Wiki</TableHead>
                <TableHead className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">Contributed By</TableHead>
                <TableHead className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">Status</TableHead>
                <TableHead className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">Created</TableHead>
                <TableHead className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground text-right w-[60px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sources.map((source) => (
                <TableRow key={source.id} className="group hover:bg-secondary/30 transition-colors">
                  {/* Document name + icon */}
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <span className="material-symbols-outlined text-muted-foreground" style={{ fontSize: 18 }}>
                        {fileIcons[getFileExt(source)] || (source.source_type === "url" ? "link" : "description")}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate max-w-[280px]">{source.title}</p>
                        {source.file_name && source.file_name !== source.title && (
                          <p className="text-[10px] text-muted-foreground truncate max-w-[280px]">{source.file_name}</p>
                        )}
                      </div>
                    </div>
                  </TableCell>

                  {/* Category (Knowledge Type) */}
                  <TableCell>
                    {source.knowledge_type_name ? (
                      <Badge
                        variant="outline"
                        className="text-[10px] font-medium h-5 px-2"
                        style={{
                          borderColor: source.knowledge_type_color,
                          color: source.knowledge_type_color,
                        }}
                      >
                        {source.knowledge_type_name}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground/50">—</span>
                    )}
                  </TableCell>

                  {/* Visibility */}
                  <TableCell>
                    <ScopeBadge scopeType={source.scope_type} scopeId={source.scope_id} />
                  </TableCell>

                  {/* Department(s) */}
                  <TableCell>
                    {source.department_names && source.department_names.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {source.department_names.map((name, i) => (
                          <span key={i} className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-secondary text-secondary-foreground">
                            {name}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground/50 italic">Global</span>
                    )}
                  </TableCell>

                  {/* Page count */}
                  <TableCell>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {source.page_count ?? "—"}
                    </span>
                  </TableCell>

                  {/* Wiki page count */}
                  <TableCell>
                    {(source.wiki_page_count ?? 0) > 0 ? (
                      <span className="text-xs text-foreground tabular-nums">
                        {source.wiki_page_count}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground/50">—</span>
                    )}
                  </TableCell>

                  {/* Contributed by */}
                  <TableCell>
                    {source.contributed_by_name ? (
                      <span className="text-xs text-muted-foreground">{source.contributed_by_name}</span>
                    ) : (
                      <span className="text-xs text-muted-foreground/50">—</span>
                    )}
                  </TableCell>

                  {/* Status */}
                  <TableCell>
                    <StatusDot source={source} />
                  </TableCell>

                  {/* Created date */}
                  <TableCell>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {new Date(source.created_at).toLocaleDateString("en-US", {
                        month: "short", day: "numeric", year: "numeric",
                      })}
                    </span>
                  </TableCell>

                  {/* Actions */}
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-accent text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                        <span className="material-symbols-outlined text-base">more_vert</span>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setEditSource(source)}>
                          <span className="material-symbols-outlined mr-2" style={{ fontSize: 16 }}>edit</span>
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleReingest(source.id)}
                          disabled={reingestingIds.has(source.id) || source.status === "processing" || source.status === "pending"}
                        >
                          <span className={`material-symbols-outlined mr-2 ${reingestingIds.has(source.id) ? "animate-spin" : ""}`} style={{ fontSize: 16 }}>
                            refresh
                          </span>
                          {reingestingIds.has(source.id) ? "Re-ingesting..." : "Re-ingest"}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => handleDelete(source.id)}
                          className="text-destructive"
                        >
                          <span className="material-symbols-outlined mr-2" style={{ fontSize: 16 }}>delete</span>
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-3">
          <span className="text-xs text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
              className="h-8 px-2.5"
            >
              <span className="material-symbols-outlined text-sm">chevron_left</span>
            </Button>
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              let p: number;
              if (totalPages <= 7) {
                p = i + 1;
              } else if (page <= 4) {
                p = i + 1;
              } else if (page >= totalPages - 3) {
                p = totalPages - 6 + i;
              } else {
                p = page - 3 + i;
              }
              return (
                <Button
                  key={p}
                  variant={p === page ? "default" : "outline"}
                  size="sm"
                  onClick={() => onPageChange(p)}
                  className={`h-8 w-8 p-0 text-xs ${p === page ? "bg-primary text-primary-foreground" : ""}`}
                >
                  {p}
                </Button>
              );
            })}
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
              className="h-8 px-2.5"
            >
              <span className="material-symbols-outlined text-sm">chevron_right</span>
            </Button>
          </div>
        </div>
      )}

      {editSource && (
        <EditSourceDialog
          source={editSource}
          types={types}
          departments={departments}
          onClose={() => setEditSource(null)}
          onSaved={() => { setEditSource(null); onRefresh(); }}
        />
      )}
    </div>
  );
}

function StatusDot({ source }: { source: Source }) {
  const colors: Record<string, string> = {
    ready: "bg-green-500",
    processing: "bg-yellow-500",
    error: "bg-destructive",
    pending: "bg-muted-foreground",
  };

  const status = source.status;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <span className={`w-2 h-2 rounded-full ${colors[status] || colors.pending}`} />
        <span className="text-xs capitalize text-muted-foreground">{status}</span>
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

function EditSourceDialog({
  source,
  types,
  departments,
  onClose,
  onSaved,
}: {
  source: Source;
  types: KnowledgeType[];
  departments: Department[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = React.useState(source.title);
  const [typeId, setTypeId] = React.useState(source.knowledge_type_id || "");
  const [selectedDepts, setSelectedDepts] = React.useState<string[]>(source.department_ids || []);
  const [scopeType, setScopeType] = React.useState(source.scope_type || "global");
  const [scopeId, setScopeId] = React.useState(source.scope_id || "");
  const [projects, setProjects] = React.useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");

  // Fetch projects for workspace scope picker
  React.useEffect(() => {
    api<{ id: string; name: string }[]>("/api/projects")
      .then((data) => setProjects(Array.isArray(data) ? data : []))
      .catch(() => setProjects([]));
  }, []);

  const toggleDept = (deptId: string) => {
    setSelectedDepts((prev) =>
      prev.includes(deptId) ? prev.filter((d) => d !== deptId) : [...prev, deptId]
    );
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      await api(`/api/sources/${source.id}`, {
        method: "PATCH",
        body: {
          title: title || undefined,
          knowledge_type_id: typeId || null,
          department_ids: selectedDepts,
          scope_type: scopeType,
          scope_id: scopeType === "global" ? null : (scopeId || null),
        },
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl">Edit Document</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 mt-2">
          <div className="flex flex-col gap-1.5">
            <Label>Title</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="bg-background"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Knowledge Type</Label>
            <Select value={typeId} onValueChange={(v) => setTypeId(v ?? "")}>
              <SelectTrigger className="bg-background">
                {typeId ? (() => { const t = types.find(x => x.id === typeId); return t ? (
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: t.color }} />
                    <span>{t.name}</span>
                  </div>
                ) : <SelectValue placeholder="No type" />; })() : <SelectValue placeholder="No type" />}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">No type</SelectItem>
                {types.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: t.color }} />
                      {t.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Multi-department selection */}
          <div className="flex flex-col gap-1.5">
            <Label>Departments</Label>
            <p className="text-xs text-muted-foreground">
              Select which departments can access this document. Leave empty for global access.
            </p>
            <div className="border rounded-lg p-2 max-h-40 overflow-y-auto bg-background">
              {departments.length === 0 ? (
                <span className="text-xs text-muted-foreground">No departments available</span>
              ) : (
                departments.map((d) => (
                  <label
                    key={d.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedDepts.includes(d.id)}
                      onChange={() => toggleDept(d.id)}
                      className="rounded border-border"
                    />
                    <span className="text-sm">{d.name}</span>
                  </label>
                ))
              )}
            </div>
            {selectedDepts.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {selectedDepts.map((id) => {
                  const name = departments.find((d) => d.id === id)?.name ?? id;
                  return (
                    <span
                      key={id}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary"
                    >
                      {name}
                      <button
                        type="button"
                        onClick={() => toggleDept(id)}
                        className="hover:text-destructive"
                      >
                        ×
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          {/* Visibility / Scope */}
          <div className="flex flex-col gap-1.5">
            <Label>Visibility</Label>
            <Select value={scopeType} onValueChange={(v) => {
              const val = v ?? "global";
              setScopeType(val);
              if (val === "global") setScopeId("");
            }}>
              <SelectTrigger className="bg-background">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
                    {scopeType === "global" ? "public" : "folder_special"}
                  </span>
                  <span className="capitalize">{scopeType === "project" ? "Workspace" : scopeType}</span>
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="global">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined" style={{ fontSize: 14 }}>public</span>
                    Global
                  </div>
                </SelectItem>
                <SelectItem value="project">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined" style={{ fontSize: 14 }}>folder_special</span>
                    Workspace
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {scopeType === "project" && (
            <div className="flex flex-col gap-1.5">
              <Label>Target Workspace</Label>
              <Select value={scopeId} onValueChange={(v) => setScopeId(v ?? "")}>
                <SelectTrigger className="bg-background">
                  <span>{scopeId ? (projects.find(p => p.id === scopeId)?.name ?? "Select...") : "Select workspace..."}</span>
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {error && (
            <p className="text-destructive text-sm bg-destructive/10 px-3 py-2 rounded-lg">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              disabled={saving}
              onClick={handleSave}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {saving ? (
                <span className="flex items-center gap-2">
                  <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span>
                  Saving...
                </span>
              ) : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

