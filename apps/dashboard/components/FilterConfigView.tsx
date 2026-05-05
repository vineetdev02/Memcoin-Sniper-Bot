"use client";

import { useCallback, useEffect, useState } from "react";
import { getSocket } from "@/lib/socket";
import {
  FILTER_LABELS,
  FILTER_ORDER,
  type FilterConfigDelta,
  type FilterId,
  type FilterPreset,
} from "@sniperbot/shared";
import { Check, Save, Trash2, ToggleLeft, ToggleRight, Pause, Play } from "lucide-react";

const THRESHOLD_FIELDS: Array<{
  key: keyof NonNullable<FilterConfigDelta["thresholds"]>;
  label: string;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  isPct?: boolean;
}> = [
  { key: "minFilterScore", label: "Min filter score", min: 0, max: 100, step: 5, suffix: "%" },
  { key: "liquidityMinUsd", label: "Liquidity min ($)", min: 0, max: 50_000, step: 500 },
  { key: "liquidityMaxUsd", label: "Liquidity max ($)", min: 10_000, max: 1_000_000, step: 5_000 },
  { key: "topHolderMaxPct", label: "Max single holder", min: 1, max: 50, step: 1, suffix: "%" },
  { key: "top10HoldersMaxPct", label: "Max top-10 holders", min: 10, max: 100, step: 1, suffix: "%" },
  { key: "devRugRateMax", label: "Dev rug rate max", min: 0, max: 1, step: 0.05, isPct: true },
  { key: "maxSellTaxPct", label: "Max sell tax", min: 0, max: 100, step: 1, suffix: "%" },
];

const TOGGLE_FIELDS: Array<{
  key: keyof NonNullable<FilterConfigDelta["thresholds"]>;
  label: string;
}> = [
  { key: "lpLockedRequired", label: "Require LP locked/burned" },
  { key: "mintAuthRenounced", label: "Require mint auth renounced" },
  { key: "freezeAuthRenounced", label: "Require freeze auth renounced" },
  { key: "honeypotSimRequired", label: "Require honeypot sim" },
  { key: "bundledLaunchReject", label: "Reject bundled launches" },
];

export function FilterConfigView() {
  const [presets, setPresets] = useState<FilterPreset[]>([]);
  const [activeName, setActiveName] = useState<string | null>(null);
  const [draft, setDraft] = useState<FilterConfigDelta>({ enabled: {}, thresholds: {} });
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const refresh = useCallback(() => {
    const socket = getSocket();
    socket.emit("presets:list", ({ presets, activeName }) => {
      setPresets(presets);
      setActiveName(activeName);
      const active = presets.find((p) => p.name === activeName);
      if (active) setDraft(active.config);
    });
  }, []);

  useEffect(() => {
    refresh();
    const socket = getSocket();
    const onChanged = ({ activeName }: { activeName: string | null }) => {
      setActiveName(activeName);
    };
    socket.on("preset:changed", onChanged);
    return () => {
      socket.off("preset:changed", onChanged);
    };
  }, [refresh]);

  const activate = (id: string) => {
    setSaving(true);
    getSocket().emit("preset:activate", id, (res) => {
      setSaving(false);
      if (res.ok && res.preset) {
        setDraft(res.preset.config);
        setActiveName(res.preset.name);
        setFeedback(`Activated ${res.preset.name}`);
        setTimeout(() => setFeedback(null), 2000);
      } else if (res.error) {
        setFeedback(`Error: ${res.error}`);
      }
    });
  };

  const deactivate = () => {
    setSaving(true);
    getSocket().emit("preset:deactivate", () => {
      setSaving(false);
      setActiveName(null);
      setFeedback("Cleared active preset (using env defaults)");
      setTimeout(() => setFeedback(null), 2000);
    });
  };

  const saveAs = () => {
    const name = window.prompt("Save current config as preset (name):");
    if (!name) return;
    const description = window.prompt("Description (optional):") ?? undefined;
    setSaving(true);
    getSocket().emit("preset:save", { name, description, config: draft }, (res) => {
      setSaving(false);
      if (res.ok) {
        setFeedback(`Saved ${name}`);
        refresh();
      } else {
        setFeedback(`Error: ${res.error}`);
      }
      setTimeout(() => setFeedback(null), 2500);
    });
  };

  const remove = (preset: FilterPreset) => {
    if (preset.isBuiltIn) return;
    if (!window.confirm(`Delete preset "${preset.name}"?`)) return;
    getSocket().emit("preset:delete", preset.id, (res) => {
      if (res.ok) refresh();
      else setFeedback(`Error: ${res.error}`);
    });
  };

  const toggleFilter = (id: FilterId) => {
    setDraft((d) => ({
      ...d,
      enabled: { ...(d.enabled ?? {}), [id]: !(d.enabled?.[id] ?? true) },
    }));
  };

  const setThreshold = (key: string, value: number | boolean | undefined) => {
    setDraft((d) => ({
      ...d,
      thresholds: { ...(d.thresholds ?? {}), [key]: value },
    }));
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h1 className="text-lg font-semibold">Filter configuration</h1>
        <div className="flex items-center gap-2 text-xs text-fg-subtle">
          {activeName ? (
            <span className="rounded bg-accent-blue/10 text-accent-blue border border-accent-blue/30 px-2 py-0.5 font-medium">
              Active: {activeName}
            </span>
          ) : (
            <span className="text-fg-muted">Using env defaults</span>
          )}
        </div>
      </div>

      {feedback && (
        <div className="rounded-md border border-accent-blue/30 bg-accent-blue/5 px-3 py-2 text-xs text-accent-blue">
          {feedback}
        </div>
      )}

      <div className="rounded-lg border border-border bg-bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium">Presets</h2>
          <div className="flex gap-2">
            <button
              onClick={saveAs}
              disabled={saving}
              className="flex items-center gap-1 rounded border border-border bg-bg-elevated px-2 py-1 text-xs hover:bg-bg disabled:opacity-50"
            >
              <Save className="h-3 w-3" /> Save current as…
            </button>
            <button
              onClick={deactivate}
              disabled={saving || !activeName}
              className="flex items-center gap-1 rounded border border-border bg-bg-elevated px-2 py-1 text-xs hover:bg-bg disabled:opacity-50"
            >
              <Pause className="h-3 w-3" /> Use env defaults
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {presets.map((p) => (
            <div
              key={p.id}
              className={`flex flex-col gap-1.5 rounded-md border p-3 ${
                p.name === activeName
                  ? "border-accent-blue/50 bg-accent-blue/5"
                  : "border-border bg-bg-elevated/30"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium">{p.name}</span>
                  {p.isBuiltIn && (
                    <span className="rounded bg-bg-elevated text-[10px] uppercase tracking-wider text-fg-subtle px-1 py-0.5">
                      built-in
                    </span>
                  )}
                </div>
                {!p.isBuiltIn && (
                  <button
                    onClick={() => remove(p)}
                    className="text-fg-muted hover:text-accent-red"
                    title="Delete preset"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {p.description && (
                <p className="text-[11px] text-fg-muted leading-snug">{p.description}</p>
              )}
              <button
                onClick={() => activate(p.id)}
                disabled={saving || p.name === activeName}
                className={`mt-1 flex items-center justify-center gap-1 rounded px-2 py-1 text-xs font-medium ${
                  p.name === activeName
                    ? "bg-accent-blue/20 text-accent-blue cursor-default"
                    : "bg-bg-elevated text-fg hover:bg-border"
                } disabled:opacity-50`}
              >
                {p.name === activeName ? (
                  <>
                    <Check className="h-3 w-3" /> Active
                  </>
                ) : (
                  <>
                    <Play className="h-3 w-3" /> Activate
                  </>
                )}
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-lg border border-border bg-bg-card p-4">
          <h2 className="mb-3 text-sm font-medium">Enabled filters</h2>
          <p className="mb-3 text-[11px] text-fg-muted">
            Edits apply on the next pool evaluation when this draft is active. Save as a preset to persist.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {FILTER_ORDER.map((id) => {
              const enabled = draft.enabled?.[id] ?? true;
              return (
                <button
                  key={id}
                  onClick={() => toggleFilter(id)}
                  className={`flex items-center justify-between gap-2 rounded border px-2.5 py-1.5 text-xs ${
                    enabled
                      ? "border-accent-green/30 bg-accent-green/5 text-fg"
                      : "border-border bg-bg-elevated/30 text-fg-muted"
                  }`}
                >
                  <span>{FILTER_LABELS[id]}</span>
                  {enabled ? (
                    <ToggleRight className="h-4 w-4 text-accent-green" />
                  ) : (
                    <ToggleLeft className="h-4 w-4" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-bg-card p-4">
          <h2 className="mb-3 text-sm font-medium">Thresholds</h2>
          <div className="flex flex-col gap-3">
            {THRESHOLD_FIELDS.map((f) => {
              const raw = draft.thresholds?.[f.key];
              const value = typeof raw === "number" ? raw : undefined;
              const display = value === undefined
                ? "(default)"
                : f.isPct
                  ? `${(value * 100).toFixed(0)}%`
                  : `${value.toLocaleString()}${f.suffix ?? ""}`;
              return (
                <div key={String(f.key)} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-fg-muted">{f.label}</span>
                    <span className="tabular-nums font-medium">{display}</span>
                  </div>
                  <input
                    type="range"
                    min={f.min}
                    max={f.max}
                    step={f.step}
                    value={value ?? f.min}
                    onChange={(e) => setThreshold(f.key, Number(e.target.value))}
                    className="w-full accent-accent-blue"
                  />
                </div>
              );
            })}
          </div>

          <h3 className="mt-4 mb-2 text-xs uppercase tracking-wider text-fg-subtle">Required-flags</h3>
          <div className="flex flex-col gap-1">
            {TOGGLE_FIELDS.map((t) => {
              const v = draft.thresholds?.[t.key];
              const enabled = typeof v === "boolean" ? v : true;
              return (
                <button
                  key={String(t.key)}
                  onClick={() => setThreshold(t.key, !enabled)}
                  className="flex items-center justify-between rounded border border-border bg-bg-elevated/30 px-2.5 py-1.5 text-xs hover:bg-bg-elevated"
                >
                  <span>{t.label}</span>
                  {enabled ? (
                    <ToggleRight className="h-4 w-4 text-accent-green" />
                  ) : (
                    <ToggleLeft className="h-4 w-4 text-fg-muted" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
