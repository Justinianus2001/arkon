export type KnowledgeType = {
  id: string;
  slug: string;
  name: string;
  color: string;
};

export type Department = {
  id: string;
  name: string;
};

export type Source = {
  id: string;
  title: string;
  file_name?: string;
  source_type?: string;
  status: "ready" | "processing" | "error" | "pending" | "plan_ready" | "awaiting_approval" | string;
  progress?: number;
  progress_message?: string;
  page_count?: number;
  wiki_page_count?: number;
  extracted_token_count?: number;
  image_count?: number;
  knowledge_type_id?: string;
  knowledge_type_name?: string;
  knowledge_type_color?: string;
  department_ids?: string[];
  department_names?: string[];
  contributed_by_name?: string;
  scope_type?: string;
  scope_id?: string;
  preserve_verbatim?: boolean;
  pipeline_strategy?: string;
  pipeline_phase?: string;
  created_at: string;
  updated_at?: string;
};
