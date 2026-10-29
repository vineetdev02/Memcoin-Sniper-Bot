"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RotateCcw, Save, ShieldAlert } from "lucide-react";
import {
  SETTING_FIELDS,
  STARTING_BALANCE_MAX_USD,
  STARTING_BALANCE_MIN_USD,
  validateSettingsPatch,
  type ResetResult,
  type SettingField,
  type SettingsSnapshot,
  type TradingSettings,
} from "@sniperbot/shared";
import { getSocket } from "@/lib/socket";
import { useFeedStore } from "@/lib/store";
import { formatUsd } from "@/lib/format";

const GROUPS: ReadonlyArray<SettingField["group"]> = ["Position sizing", "Exits", "Risk", "Filters"];

type Draft = Record<keyof TradingSettings, string>;

const toDraft = (s: TradingSettings): Draft =>
  Object.fromEntries(Object.entries(s).map(([k, v]) => [k, String(v)])) as Draft;

/** What the form says that differs from what is saved, typed the way the engine expects. */
function pendingChanges(draft: Draft, saved: TradingSettings): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(saved) as Array<keyof TradingSettings>) {
    const text = draft[key].trim();
    if (key === "tpLadder") {
      if (text.replace(/\s+/g, "") !== saved.tpLadder) out.tpLadder = text;
      continue;
    }
    const n = text === "" ? Number.NaN : Number(text);
    if (n !== saved[key]) out[key] = n;
  }
  return out;
}

const inputClass =
  "w-full rounded border bg-bg-elevated px-2 py-1.5 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-accent-blue/50";

export function SettingsView() {
  const status = useFeedStore((s) => s.status);
  const bankroll = useFeedStore((s) => s.bankroll);
  const connected = useFeedStore((s) => s.connected);
  const [snap, setSnap] = useState<SettingsSnapshot | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback((s: SettingsSnapshot) => {
    setSnap(s);
    setDraft(toDraft(s.settings));
  }, []);

  useEffect(() => {
    const socket = getSocket();
    const fetchSettings = () => socket.emit("settings:get", load);
    socket.on("connect", fetchSettings);
    socket.on("settings:changed", load);
    if (socket.connected) fetchSettings();
    return () => {
      socket.off("connect", fetchSettings);
      socket.off("settings:changed", load);
    };
  }, [load]);

  const pending = useMemo(() => (snap && draft ? pendingChanges(draft, snap.settings) : {}), [snap, draft]);
  const check = useMemo(() => validateSettingsPatch(pending), [pending]);
  const dirty = Object.keys(pending).length > 0;

  const save = () => {
    if (!check.ok) return;
    setSaving(true);
    setMessage(null);
    getSocket().emit("settings:save", check.value, (res) => {
      setSaving(false);
      if (res.ok && res.snapshot) {
        load(res.snapshot);
        setMessage({ ok: true, text: "Saved. It applies from the next trade; exits apply to positions opened from now on." });
      } else {
        setMessage({ ok: false, text: res.error ?? "save failed" });
      }
    });
  };

  if (!snap || !draft) {
    return (
      <div className="rounded-lg border border-border bg-bg-card p-4 text-sm text-fg-muted">
        {connected ? "Loading settings…" : "Waiting for the engine…"}
      </div>
    );
  }

  const setField = (key: keyof TradingSettings, value: string) => {
    setDraft({ ...draft, [key]: value });
    setMessage(null);
  };

  const canSave = dirty && check.ok && !saving && connected;
  const saveButtons = (
    <div className="flex items-center gap-2">
      {dirty && (
        <button
          onClick={() => {
            setDraft(toDraft(snap.settings));
            setMessage(null);
          }}
          className="rounded border border-border px-3 py-2 text-sm text-fg-muted hover:text-fg"
        >
          Discard
        </button>
      )}
      <button
        onClick={save}
        disabled={!canSave}
        className={`flex items-center gap-1.5 rounded border px-4 py-2 text-sm font-medium transition-colors ${
          canSave
            ? "border-accent-blue bg-accent-blue text-white shadow-sm hover:brightness-110"
            : "cursor-not-allowed border-border bg-bg-elevated/40 text-fg-subtle"
        }`}
      >
        <Save className="h-3.5 w-3.5" />
        {saving ? "Saving…" : "Save changes"}
      </button>
    </div>
  );
  const changeCount = Object.keys(pending).length;
  const balanceUsd = bankroll?.balanceUsd ?? snap.startingBalanceUsd;
  const sizePct = Number(draft.positionSizePct);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-border bg-bg-card p-4">
        <h2 className="text-sm font-medium">Paper account</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:max-w-md">
          <Stat label="Started with" value={formatUsd(snap.startingBalanceUsd)} />
          <Stat label="Bankroll now" value={formatUsd(balanceUsd)} />
        </div>
        <ResetPanel
          key={snap.startingBalanceUsd}
          startingBalanceUsd={snap.startingBalanceUsd}
          blocked={
            !connected
              ? "The engine is offline."
              : status?.mode === "live"
                ? "Reset is for paper trading only."
                : status?.botOn
                  ? "Turn the bot off first (the Bot ON button in the header)."
                  : null
          }
        />
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-medium">Trading settings</h2>
          <p className="mt-1 text-[11px] text-fg-muted">
            Saved here, they override .env and survive restarts. Each one shows its .env value when it differs.
          </p>
        </div>
        {saveButtons}
      </div>

      {(message || (dirty && !check.ok)) && (
        <div
          className={`rounded-lg border p-3 text-sm ${
            message?.ok ? "border-accent-green/30 bg-accent-green/5 text-accent-green" : "border-accent-red/30 bg-accent-red/5 text-accent-red"
          }`}
        >
          {message ? message.text : !check.ok ? check.error : null}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {GROUPS.map((group) => (
          <div key={group} className="rounded-lg border border-border bg-bg-card p-4">
            <h3 className="mb-3 text-xs uppercase tracking-wider text-fg-subtle">{group}</h3>
            <div className="flex flex-col gap-4">
              {SETTING_FIELDS.filter((f) => f.group === group).map((f) => (
                <Field
                  key={f.key}
                  label={f.label}
                  help={f.help}
                  unit={f.unit}
                  value={draft[f.key]}
                  saved={snap.settings[f.key]}
                  envDefault={snap.defaults[f.key]}
                  envName={f.envName}
                  invalid={f.key in pending && !validateSettingsPatch({ [f.key]: pending[f.key] }).ok}
                  onChange={(v) => setField(f.key, v)}
                  note={
                    f.key === "positionSizePct" && Number.isFinite(sizePct) && sizePct > 0
                      ? `≈ ${formatUsd((balanceUsd * sizePct) / 100)} per trade at the current bankroll`
                      : undefined
                  }
                />
              ))}
              {group === "Exits" && (
                <Field
                  label="Take-profit ladder"
                  help="gain%:sell% steps — 50:25 sells a quarter at +50%"
                  value={draft.tpLadder}
                  saved={snap.settings.tpLadder}
                  envDefault={snap.defaults.tpLadder}
                  envName="TP_LADDER"
                  text
                  invalid={"tpLadder" in pending && !validateSettingsPatch({ tpLadder: pending.tpLadder }).ok}
                  onChange={(v) => setField("tpLadder", v)}
                />
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Follows the scroll while anything is unsaved, so Save is never off screen. */}
      {dirty && (
        <div className="sticky bottom-3 z-20 flex flex-col gap-2 rounded-lg border border-accent-blue/40 bg-bg-card/95 px-4 py-3 shadow-xl backdrop-blur sm:flex-row sm:items-center sm:justify-between">
          <span className="text-sm">
            {changeCount} unsaved {changeCount === 1 ? "change" : "changes"}
            {!check.ok && <span className="ml-2 text-accent-red">— {check.error}</span>}
          </span>
          {saveButtons}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-bg-elevated/30 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-fg-subtle">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Field(props: {
  label: string;
  help: string;
  unit?: string;
  value: string;
  saved: number | string;
  envDefault: number | string;
  envName: string;
  invalid: boolean;
  text?: boolean;
  note?: string;
  onChange: (value: string) => void;
}) {
  const edited = props.value.trim().replace(/\s+/g, "") !== String(props.saved);
  const overridden = props.saved !== props.envDefault;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <label className="font-medium text-fg">{props.label}</label>
        {overridden && (
          <button
            onClick={() => props.onChange(String(props.envDefault))}
            className="flex items-center gap-1 text-[11px] text-fg-muted hover:text-fg"
            title={`Back to the .env value (${props.envName})`}
          >
            <RotateCcw className="h-3 w-3" />
            .env: {String(props.envDefault)}
            {props.unit && !props.text ? props.unit : ""}
          </button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <input
          type={props.text ? "text" : "number"}
          step="any"
          inputMode={props.text ? "text" : "decimal"}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          aria-invalid={props.invalid}
          className={`${inputClass} ${
            props.invalid ? "border-accent-red/60" : edited ? "border-accent-blue/50" : "border-border"
          }`}
        />
        {props.unit && <span className="w-8 shrink-0 text-xs text-fg-muted">{props.unit}</span>}
      </div>
      <p className="text-[11px] leading-snug text-fg-muted">{props.help}</p>
      {props.note && <p className="text-[11px] leading-snug text-accent-blue">{props.note}</p>}
    </div>
  );
}

function ResetPanel({ startingBalanceUsd, blocked }: { startingBalanceUsd: number; blocked: string | null }) {
  const [amount, setAmount] = useState(String(startingBalanceUsd));
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ResetResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const value = Number(amount);
  const amountOk = amount.trim() !== "" && Number.isFinite(value) && value >= STARTING_BALANCE_MIN_USD && value <= STARTING_BALANCE_MAX_USD;
  const ready = !blocked && amountOk && confirm.trim().toUpperCase() === "RESET" && !busy;

  const run = () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    setResult(null);
    getSocket().emit("account:reset", { startingBalanceUsd: value }, (res) => {
      setBusy(false);
      if (res.ok && res.result) {
        setResult(res.result);
        setConfirm("");
      } else {
        setError(res.error ?? "reset failed");
      }
    });
  };

  return (
    <div className="mt-4 rounded-md border border-accent-red/30 bg-accent-red/5 p-3">
      <div className="flex items-center gap-2 text-sm font-medium text-accent-red">
        <ShieldAlert className="h-4 w-4" />
        Start over
      </div>
      <p className="mt-1 text-[11px] leading-snug text-fg-muted">
        Deletes every paper trade and position, the bankroll history, the stored pools and their filter results, and
        empties the live feed. A backup file of all of it is written first. Filter presets, these settings and the
        rugged-dev list are kept.
      </p>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex flex-col gap-1 sm:w-48">
          <label className="text-[10px] uppercase tracking-wider text-fg-subtle">New starting amount ($)</label>
          <input
            type="number"
            min={STARTING_BALANCE_MIN_USD}
            max={STARTING_BALANCE_MAX_USD}
            step="any"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-invalid={!amountOk}
            className={`${inputClass} ${amountOk ? "border-border" : "border-accent-red/60"}`}
          />
        </div>
        <div className="flex flex-col gap-1 sm:w-48">
          <label className="text-[10px] uppercase tracking-wider text-fg-subtle">Type RESET to confirm</label>
          <input
            type="text"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="off"
            className={`${inputClass} border-border`}
          />
        </div>
        <button
          onClick={run}
          disabled={!ready}
          className="rounded border border-accent-red/40 bg-accent-red/15 px-4 py-2 text-sm font-medium text-accent-red hover:bg-accent-red/25 disabled:opacity-50"
        >
          {busy ? "Resetting…" : "Reset paper account"}
        </button>
      </div>
      {!amountOk && (
        <p className="mt-2 text-[11px] text-accent-red">
          Between {formatUsd(STARTING_BALANCE_MIN_USD)} and {formatUsd(STARTING_BALANCE_MAX_USD)}.
        </p>
      )}
      {blocked && <p className="mt-2 text-[11px] text-accent-amber">{blocked}</p>}
      {error && <p className="mt-2 text-sm text-accent-red">{error}</p>}
      {result && (
        <div className="mt-3 rounded border border-accent-green/30 bg-accent-green/5 p-2 text-[11px] leading-relaxed text-accent-green">
          Reset to {formatUsd(result.startingBalanceUsd)}. Deleted{" "}
          {Object.entries(result.deleted)
            .map(([table, n]) => `${n} ${table}`)
            .join(", ")}
          .
          <br />
          Backup: <span className="break-all font-mono">{result.backupFile}</span>
        </div>
      )}
    </div>
  );
}
