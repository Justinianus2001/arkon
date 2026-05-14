"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";

// Shape shared by LLMSpecOut and VisionSpecOut on the backend. Cards pick which
// fields to display via the `renderMeta` prop so this component stays generic.
export type ModelSpec = {
  id: string;
  provider: string;
  model_id: string;
  label: string;
  notes: string | null;
  api_key_configured: boolean;
  // LLM-specific
  context_window_tokens?: number;
  max_output_tokens?: number;
  supports_tools?: boolean;
  supports_vision?: boolean;
  cost_per_1m_input_tokens?: number | null;
  cost_per_1m_output_tokens?: number | null;
  // Vision-specific
  max_image_size_mb?: number;
  cost_per_image?: number | null;
};

type CatalogResp = {
  active_spec_id: string | null;
  specs: ModelSpec[];
};

export function ModelCatalogCard({
  title,
  description,
  icon,
  catalogUrl,
  switchUrl,
  apiKeyConfigKey,
  renderMeta,
}: {
  title: string;
  description: string;
  icon: string;
  catalogUrl: string;
  switchUrl: string;
  apiKeyConfigKey: string; // e.g. "llm_api_key" or "vision_api_key"
  renderMeta?: (spec: ModelSpec) => React.ReactNode;
}) {
  const [catalog, setCatalog] = useState<CatalogResp | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [maskedKey, setMaskedKey] = useState<string>("");
  const [apiKey, setApiKey] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh() {
    try {
      const [c, settings] = await Promise.all([
        api<CatalogResp>(catalogUrl),
        api<Record<string, unknown>>("/api/settings"),
      ]);
      setCatalog(c);
      const v = settings[apiKeyConfigKey];
      const masked = typeof v === "string" ? v : "";
      setMaskedKey(masked);
      setApiKey(masked);
      setSelected((prev) => prev ?? c.active_spec_id ?? c.specs[0]?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : `Failed to load ${title}`);
    }
  }

  const selectedSpec = catalog?.specs.find((s) => s.id === selected) ?? null;
  const isActiveSelected = selectedSpec?.id === catalog?.active_spec_id;
  const willSwitch = !!selectedSpec && !isActiveSelected;
  const isMaskedKey = apiKey.includes("•");
  const hasNewKey = apiKey.trim().length > 0 && !isMaskedKey;
  const canSave =
    !!selectedSpec && (hasNewKey || (willSwitch && selectedSpec.api_key_configured));

  async function handleSave() {
    if (!selectedSpec) return;
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      if (hasNewKey) {
        await api("/api/settings", {
          method: "PUT",
          body: { settings: { [apiKeyConfigKey]: apiKey.trim() } },
        });
      }
      if (willSwitch) {
        await api(switchUrl, {
          method: "POST",
          body: { model_spec_id: selectedSpec.id },
        });
      }
      await refresh();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (!catalog) {
    return (
      <div className="bg-card rounded-xl p-6 border border-border shadow-sahara">
        <p className="text-sm text-muted-foreground">Loading {title.toLowerCase()}…</p>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-xl p-6 border border-border shadow-sahara">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
          <span className="material-symbols-outlined text-primary text-base">{icon}</span>
        </div>
        <div className="flex-1">
          <h3 className="text-base font-semibold text-foreground">{title}</h3>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>

      {/* Model list */}
      <div className="flex flex-col gap-2 mb-4">
        {catalog.specs.map((spec) => {
          const isActive = spec.id === catalog.active_spec_id;
          const isChecked = spec.id === selected;
          return (
            <label
              key={spec.id}
              className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                isChecked ? "border-primary bg-primary/5" : "border-border hover:bg-accent/30"
              }`}
            >
              <input
                type="radio"
                name={`${title}-spec`}
                value={spec.id}
                checked={isChecked}
                onChange={() => setSelected(spec.id)}
                className="mt-1"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{spec.label}</span>
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground bg-secondary/40 px-1.5 py-0.5 rounded">
                    {spec.provider}
                  </span>
                  {isActive && (
                    <span className="text-[10px] uppercase tracking-wide bg-green-500/15 text-green-700 dark:text-green-400 px-1.5 py-0.5 rounded">
                      Active
                    </span>
                  )}
                </div>
                {renderMeta && (
                  <div className="text-[11px] text-muted-foreground mt-1">
                    {renderMeta(spec)}
                  </div>
                )}
                {spec.notes && (
                  <p className="text-[11px] text-muted-foreground/80 mt-1 italic">{spec.notes}</p>
                )}
              </div>
            </label>
          );
        })}
      </div>

      {/* API key — single per capability */}
      {selectedSpec && (
        <div className="mb-4 flex flex-col gap-1.5">
          <Label className="text-xs">
            API key
            {selectedSpec.api_key_configured && (
              <span className="ml-2 text-green-600 dark:text-green-400">✓ saved</span>
            )}
          </Label>
          <Input
            type={isMaskedKey ? "text" : "password"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onFocus={() => {
              if (isMaskedKey) setApiKey("");
            }}
            onBlur={() => {
              if (!apiKey) setApiKey(maskedKey);
            }}
            placeholder={
              selectedSpec.api_key_configured ? "Replace existing key…" : "Paste API key"
            }
            className="bg-background"
          />
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          disabled={!canSave || saving}
          onClick={handleSave}
          className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? "Saving…" : willSwitch ? "Switch & Save" : "Save"}
        </button>
        {saved && (
          <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
            <span className="material-symbols-outlined text-sm">check_circle</span>
            Saved
          </span>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
}
