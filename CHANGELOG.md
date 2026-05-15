# Changelog

All notable changes to Arkon are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [0.3.1] — 2026-05-14

### Added

- **Wiki Graph — Department Clustering**: Wiki pages scoped to a department now visually group into department clusters on the `/wiki/graph` canvas.
  - Convex hull drawn per department (below project hulls) with a distinct color per department.
  - Force simulation biases nodes toward their department's X-zone (70% scope pull, 30% component spread) so related pages naturally converge.
  - Legend lists each department with icon `business` and page count.
  - Tooltip shows department name for dept-scoped pages.

### Fixed

- Graph endpoint now joins the `Department` table so `scope_name` is populated for department-scoped pages (previously only `Project` was joined, leaving dept nodes without a name label).

---

## [0.3.0] — 2026-05-13

### Added

- **Department-level Wiki Isolation**: Wiki pages compiled from department-scoped sources are now restricted to members of that department.
  - `ScopeType.DEPARTMENT` added to the enum; pipeline `_resolve_wiki_scopes()` resolves project > department(s) > global, fanning out multi-department sources into one page per department scope (LLM runs once, content is duplicated to each scope).
  - `wiki_service._scope_filter_with_dept()` provides a single-query OR filter (global + user's department).
  - `get_wiki_page` returns HTTP 403 for cross-department access.
  - Source PATCH: changing department on a `ready` source triggers wiki detach, old-scope index regeneration, and MRP re-queue automatically.
  - Frontend: edit-source dialog warns before department reassignment triggers re-analysis.

- **MRP Pipeline — Plan Regeneration with Reviewer Feedback**: Admin can now reject a pending plan with a note, triggering LLM-based regeneration that incorporates the feedback.
  - `POST /sources/{id}/plan/regenerate` runs in the background via `regenerate_plan_task`.
  - Plan Review Dialog surfaces a *Regenerate* button that requires a reviewer note.
  - `_resolve_maybe_items` uses LLM to decide UPDATE vs CREATE (previously always downgraded MAYBE to CREATE).

- **Catalog-driven LLM & Vision Selection**: Replaces free-form `llm_provider + llm_model_id` config with curated catalogs (`LLMModelSpec`, `VisionModelSpec`) that expose context window size, tool support, vision capability, and per-token cost.
  - `/api/settings/{llm,vision}/{catalog,switch}` endpoints mirror the embedding catalog pattern.
  - Settings UI renders a `ModelCatalogCard` per capability with metadata (context window, costs, tool/vision badges).
  - `writer._get_source_context_budget` reads `context_window_tokens` from the spec — the stale hard-coded table is removed.

- **Gemini Model Updates**: Catalog updated with newer Gemini variants.
  - `gemini-3.1-flash-lite`: 1M context, tools + vision + thinking, cheapest Google 1M option ($0.25 in / $1.50 out per 1M tokens). New recommended default for high-volume extraction and captioning.
  - `gemini-3-flash-preview` and two additional preview models added.
  - Admins on `gemini-3.1-flash` must reselect in Settings (model removed from catalog).

### Fixed

- **MRP Pipeline Hardening** (critical):
  - Draft results (`PageWriteResult`) now persisted in `plan_json._page_drafts`; VERIFY/COMMIT phases resume without re-running REFINE.
  - `caption_images_task` is now serialized before `ingest_map_reduce_task`, baking captions into `source.full_text` before MAP runs — fixes the race condition that produced empty image markers in compiled wiki pages.
  - KB reconciliation searches every destination scope and retains the best semantic match, preventing duplicate pages when the same concept exists across scopes.

- **MRP Pipeline Hardening** (high):
  - `assemble_evidence` uses word-boundary regex (`\bterm\b`) instead of substring matching, so short entity names (e.g. "AI") no longer match unrelated subjects ("MAIL").
  - `/sources/{id}/plan/regenerate` runs async via arq; UI polls `GET /plan` instead of holding an open HTTP connection.
  - JSON fence stripping unified via `parse_json_loose`; removes several incorrect `str.strip("```json")` variants in mapper and wiki_analyzer.

- **MRP Pipeline Hardening** (medium):
  - Approve/reject/regenerate endpoints use `SELECT FOR UPDATE` and reject mismatched status to prevent race conditions.

---

## [0.2.x] — prior releases

See git log.
