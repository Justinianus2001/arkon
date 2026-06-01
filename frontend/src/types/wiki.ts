export type WikiPageType = "entity" | "concept" | "topic" | "source" | "index" | "log" | "hot";

export type WikiPageSummary = {
  slug: string;
  title: string;
  page_type: WikiPageType;
  status: "seed" | "developing" | "mature" | "evergreen";
  summary: string;
  knowledge_type_slugs: string[];
  source_ids: string[];
  scope_type?: string;
  scope_id?: string | null;
  scope_name?: string | null;
  version: number;
  updated_at: string;
};

export type WikiScope = {
  scope_type: string;
  scope_id: string | null;
  name: string;
};

export type WikiPageDetail = WikiPageSummary & {
  content_md: string;
  backlinks: string[];
  outlinks: string[];
  orphaned?: boolean;
};

export type WikiGraphNode = {
  slug: string;
  title: string;
  page_type: string;
  status?: string;
  scope_type?: string;
  scope_id?: string | null;
  scope_name?: string | null;
  // injected by d3-force simulation
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
};

export type WikiGraphEdge = {
  from: string;
  to: string;
  // d3-force replaces string refs with node objects after simulation init
  source?: WikiGraphNode | string;
  target?: WikiGraphNode | string;
};

export type DraftStatus =
  | "pending"
  | "needs_revision"
  | "withdrawn"
  | "approved"
  | "rejected";

export type DraftKind = "edit" | "create";

export type AiCheckStatus = "pending" | "queued" | "running" | "passed" | "warned" | "failed" | "skipped";

export type AiCheckItem = {
  id: string;
  layer: "L1" | "L2" | "L3" | "L4";
  severity: "block" | "warn";
  status: "pass" | "warn" | "fail" | "skipped";
  message: string | null;
  matches: Array<string | { slug?: string; title?: string; score?: number; line?: number; snippet?: string }>;
};

export type AiCheckResults = {
  version: number;
  summary: { pass: number; warn: number; fail: number; skipped: number };
  checks: AiCheckItem[];
};

export type DraftSuggestedMetadata = {
  slug?: string;
  title?: string;
  page_type?: string;
  knowledge_type_slugs?: string[];
  scope_type?: string;
  scope_id?: string | null;
};

export type AuthorStats = {
  approved: number;
  rejected: number;
  needs_revision: number;
  total_reviewed: number;
  accuracy: number;
};

export type SuggestedReviewer = {
  id: string;
  name: string | null;
  email: string | null;
  score: number;
};

export type DraftResponse = {
  id: string;
  page_id: string | null;
  page_slug: string;
  page_title: string;
  page_scope_type: string;
  page_scope_id: string | null;
  page_scope_name: string | null;
  page_version: number;
  base_version: number | null;
  has_conflict: boolean;
  draft_kind: DraftKind | string;
  suggested_metadata: DraftSuggestedMetadata | null;
  author_id: string | null;
  author_name: string | null;
  author_stats: AuthorStats | null;
  suggested_reviewers: SuggestedReviewer[];
  content_md: string;
  note: string | null;
  status: DraftStatus | string;
  revision_round: number;
  last_returned_note: string | null;
  ai_check_status: AiCheckStatus | string;
  ai_check_results: AiCheckResults | null;
  ai_checked_at: string | null;
  source: string;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  reviewer_note: string | null;
  created_at: string;
  updated_at: string;
};

export type DraftRoundResponse = {
  id: string;
  round_no: number;
  content_md: string;
  author_note: string | null;
  reviewer_return_note: string | null;
  ai_check_results: AiCheckResults | null;
  submitted_at: string;
};

export type WikiGraphData = {
  nodes: WikiGraphNode[];
  edges: WikiGraphEdge[];
  total?: number;
  offset?: number;
  has_more?: boolean;
};
