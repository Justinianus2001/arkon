"use client";

import React from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Settings = Record<string, string | null>;

const SMTP_KEYS = [
  "smtp_enabled",
  "smtp_host",
  "smtp_port",
  "smtp_username",
  "smtp_password",
  "smtp_from",
  "smtp_use_tls",
] as const;

const WEBHOOK_KEYS = [
  "webhook_enabled",
  "webhook_url",
  "webhook_secret",
] as const;

export function NotificationChannelsCard() {
  const [settings, setSettings] = React.useState<Settings>({});
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [savedAt, setSavedAt] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(() => {
    setLoading(true);
    api<Settings>("/api/admin-settings/settings")
      .then((s) => setSettings(s || {}))
      .catch(() => setSettings({}))
      .finally(() => setLoading(false));
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const update = (key: string, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const save = async (keys: readonly string[]) => {
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, string> = {};
      for (const k of keys) {
        const v = settings[k];
        if (v != null) payload[k] = v;
      }
      await api("/api/admin-settings/settings", {
        method: "PUT",
        body: { settings: payload },
      });
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const smtpEnabled = (settings.smtp_enabled || "false") === "true";
  const webhookEnabled = (settings.webhook_enabled || "false") === "true";

  return (
    <div className="rounded-xl border bg-card p-5 flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <span className="material-symbols-outlined text-muted-foreground" style={{ fontSize: 20 }}>
          campaign
        </span>
        <div>
          <h2 className="font-semibold">Notification channels</h2>
          <p className="text-sm text-muted-foreground">
            Fan out in-app notifications to email and outbound webhooks. Disabled by default.
          </p>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* SMTP */}
      <fieldset className="rounded-lg border border-border p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <legend className="text-sm font-medium px-1">Email (SMTP)</legend>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={smtpEnabled}
              onChange={(e) => update("smtp_enabled", e.target.checked ? "true" : "false")}
              disabled={loading}
            />
            Enabled
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1">
            <Label htmlFor="smtp-host">Host</Label>
            <Input
              id="smtp-host"
              value={settings.smtp_host || ""}
              onChange={(e) => update("smtp_host", e.target.value)}
              placeholder="smtp.gmail.com"
              disabled={!smtpEnabled || loading}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="smtp-port">Port</Label>
            <Input
              id="smtp-port"
              value={settings.smtp_port || ""}
              onChange={(e) => update("smtp_port", e.target.value)}
              placeholder="587"
              disabled={!smtpEnabled || loading}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="smtp-user">Username</Label>
            <Input
              id="smtp-user"
              value={settings.smtp_username || ""}
              onChange={(e) => update("smtp_username", e.target.value)}
              disabled={!smtpEnabled || loading}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="smtp-pass">Password</Label>
            <Input
              id="smtp-pass"
              type="password"
              value={settings.smtp_password || ""}
              onChange={(e) => update("smtp_password", e.target.value)}
              placeholder={settings.smtp_password === "" ? "(unchanged)" : ""}
              disabled={!smtpEnabled || loading}
            />
          </div>
          <div className="grid gap-1 col-span-2">
            <Label htmlFor="smtp-from">From address</Label>
            <Input
              id="smtp-from"
              value={settings.smtp_from || ""}
              onChange={(e) => update("smtp_from", e.target.value)}
              placeholder='Arkon <noreply@your-org.example>'
              disabled={!smtpEnabled || loading}
            />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={(settings.smtp_use_tls || "true") === "true"}
            onChange={(e) => update("smtp_use_tls", e.target.checked ? "true" : "false")}
            disabled={!smtpEnabled || loading}
          />
          Use STARTTLS
        </label>
        <div className="flex justify-end">
          <Button size="sm" onClick={() => save(SMTP_KEYS)} disabled={busy || loading}>
            Save SMTP settings
          </Button>
        </div>
      </fieldset>

      {/* Webhook */}
      <fieldset className="rounded-lg border border-border p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <legend className="text-sm font-medium px-1">Outbound webhook</legend>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={webhookEnabled}
              onChange={(e) => update("webhook_enabled", e.target.checked ? "true" : "false")}
              disabled={loading}
            />
            Enabled
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          Every notification event is POSTed as JSON to this URL. If you set a secret, Arkon
          signs each payload with HMAC-SHA256 in the <code>X-Arkon-Signature</code> header.
        </p>
        <div className="grid gap-1">
          <Label htmlFor="wh-url">Endpoint URL</Label>
          <Input
            id="wh-url"
            value={settings.webhook_url || ""}
            onChange={(e) => update("webhook_url", e.target.value)}
            placeholder="https://relay.example.com/arkon"
            disabled={!webhookEnabled || loading}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="wh-secret">HMAC secret (optional)</Label>
          <Input
            id="wh-secret"
            type="password"
            value={settings.webhook_secret || ""}
            onChange={(e) => update("webhook_secret", e.target.value)}
            disabled={!webhookEnabled || loading}
          />
        </div>
        <div className="flex justify-end">
          <Button size="sm" onClick={() => save(WEBHOOK_KEYS)} disabled={busy || loading}>
            Save webhook settings
          </Button>
        </div>
      </fieldset>

      {savedAt && (
        <p className="text-xs text-muted-foreground">
          Saved at {new Date(savedAt).toLocaleTimeString()}.
        </p>
      )}
    </div>
  );
}
