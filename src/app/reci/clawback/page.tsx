"use client";

/**
 * Clawback Dashboard. Visible to jimmy + pauline + poz only (the nav
 * hides this link from everyone else, and /api/reci/clawback/* return
 * 403 for anyone who tries to hit it directly).
 *
 * Phase 1 scope (this file):
 *   - Upload widget: drag-drop an EBAH xlsx; POST to /api/reci/clawback/upload.
 *   - Summary tiles: total CB exposure, total saved, net at risk, total cases.
 *   - Per-bucket tiles: Tan / Hayder / Xstaff / Legacy / Needs review.
 *   - Cases table with filters (status, bucket, free-text search).
 *
 * Phase 2 (separate PR): inline status editing, notes, money-off events,
 * email triggers, reporting roll-ups.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { PrintButton, PrintHeader } from "@/components/print";
import { CaseDrawer, type DrawerCaseRow } from "./case-drawer";
import { NewCaseModal } from "./new-case-modal";

interface MeResp {
  username: string;
  role: string;
  canClawback: boolean;
  isClawbackAdmin: boolean;
  isClawbackSeller: boolean;
  isClawbackViewer: boolean;
  canEditClawback: boolean;
  canUploadEbah: boolean;
  canNotifyCam: boolean;
  clawbackAdviserId: number | null;
  clawbackAdviserName: string | null;
}

type Bucket = "adviser" | "xstaff" | "legacy" | "needs_review";
type Status = "open" | "saved" | "resold" | "dead" | "reinstated" | "closed";

interface CaseRow {
  id: number;
  policy_number: string;
  provider: string;
  client_name: string;
  client_dob: string | null;
  postcode: string | null;
  policy_type: string | null;
  net_premium: string | null;
  clawback_due: string | null;
  openwork_clawback_due: string | null;
  openwork_cb_updated_by: string | null;
  openwork_cb_updated_at: string | null;
  effective_clawback_due: string | null;
  clawback_date: string | null;
  policy_start_date: string | null;
  off_risk_date: string | null;
  ebah_agent_name: string;
  master_agent_no: string | null;
  agent_no: string | null;
  source: "old_ow" | "new_ow" | "other" | null;
  source_updated_by: string | null;
  source_updated_at: string | null;
  ebah_warning: string | null;
  status: Status;
  status_note: string | null;
  saved_amount: string | null;
  resold_amount: string | null;
  net_at_risk: string | null;
  notification_week: number | null;
  adviser_id: number | null;
  adviser_name: string | null;
  agent_bucket: Bucket;
  updated_at: string;
}

interface WarningRow {
  warning: string;
  cases: number;
  clawback_due: number;
}

type Sort = "cb_desc" | "cb_asc" | "cb_due_asc" | "cb_due_desc" | "client_asc";
const SORT_LABELS: Record<Sort, string> = {
  cb_desc:     "CB value (highest first)",
  cb_asc:      "CB value (lowest first)",
  cb_due_asc:  "CB date (soonest first)",
  cb_due_desc: "CB date (latest first)",
  client_asc:  "Client surname A-Z",
};

const SOURCE_LABELS: Record<"old_ow" | "new_ow" | "other", string> = {
  old_ow: "Old OW",
  new_ow: "New OW",
  other:  "Other",
};

interface Summary {
  total_cases: number;
  total_clawback_due: number;
  total_saved: number;
  total_resold: number;
  total_net_at_risk: number;
}

interface BucketRow {
  agent_bucket: Bucket;
  adviser_name: string | null;
  adviser_id: number | null;
  cases: number;
  clawback_due: number;
  net_at_risk: number;
}

interface RecentUpload {
  id: number;
  filename: string;
  uploaded_by: string;
  uploaded_at: string;
  report_date: string | null;
  rows_total: number;
  rows_inserted: number;
  rows_updated: number;
  rows_unchanged: number;
  rows_unmatched: number;
}

const STATUS_LABELS: Record<Status, string> = {
  open: "Open",
  saved: "Saved",
  resold: "Resold",
  dead: "Dead in water",
  reinstated: "Reinstated",
  closed: "Closed",
};

const BUCKET_LABELS: Record<Bucket, string> = {
  adviser: "Adviser",
  xstaff: "Xstaff",
  legacy: "Legacy",
  needs_review: "Needs review",
};

function gbp(v: string | number | null | undefined) {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function ClawbackPage() {
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [buckets, setBuckets] = useState<BucketRow[]>([]);
  const [recentUploads, setRecentUploads] = useState<RecentUpload[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [bucketFilter, setBucketFilter] = useState<string>("");
  const [warningFilter, setWarningFilter] = useState<string>("");
  const [cbDueFrom, setCbDueFrom] = useState<string>("");
  const [cbDueTo, setCbDueTo] = useState<string>("");
  const [cbMin, setCbMin] = useState<string>("");
  const [cbMax, setCbMax] = useState<string>("");
  const [masterAgentNo, setMasterAgentNo] = useState<string>("");
  const [agentNo, setAgentNo] = useState<string>("");
  const [surname, setSurname] = useState<string>("");
  const [sourceFilter, setSourceFilter] = useState<string>("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("cb_desc");
  const [moreOpen, setMoreOpen] = useState<boolean>(false);
  const [warnings, setWarnings] = useState<WarningRow[]>([]);

  // Upload state
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<string | null>(null);

  // Open drawer (clicked row)
  const [openCase, setOpenCase] = useState<CaseRow | null>(null);

  // Manual New Case modal (admin only).
  const [newCaseOpen, setNewCaseOpen] = useState(false);

  // Backfill Notify (admin only). State only -- runner defined after load().
  const [backfillBusy, setBackfillBusy] = useState(false);

  // Capabilities from /api/me. Drive what's editable / uploadable / notifiable.
  const [me, setMe] = useState<MeResp | null>(null);
  useEffect(() => {
    fetch("/api/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: MeResp | null) => { if (j) setMe(j); })
      .catch(() => { /* ignore */ });
  }, []);

  // Pre-fill the search box from the URL ?q= parameter on first mount.
  // Used by the "Open this case" deep-link in the Notify / Resolved
  // emails so clicking through filters straight to the policy number.
  // Stray leading / trailing apostrophes get stripped (some EBAH-derived
  // policy numbers historically had them).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const qs = new URLSearchParams(window.location.search);
    const q = qs.get("q");
    if (q) setSearch(q.replace(/^'|'$/g, ""));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams();
      if (statusFilter)         p.set("status",          statusFilter);
      if (bucketFilter)         p.set("bucket",          bucketFilter);
      if (warningFilter)        p.set("warning",         warningFilter);
      if (cbDueFrom)            p.set("cb_due_from",     cbDueFrom);
      if (cbDueTo)              p.set("cb_due_to",       cbDueTo);
      if (cbMin)                p.set("cb_min",          cbMin);
      if (cbMax)                p.set("cb_max",          cbMax);
      if (masterAgentNo.trim()) p.set("master_agent_no", masterAgentNo.trim());
      if (agentNo.trim())       p.set("agent_no",        agentNo.trim());
      if (surname.trim())       p.set("surname",         surname.trim());
      if (sourceFilter)         p.set("source",          sourceFilter);
      if (search.trim())        p.set("q",               search.trim());
      if (sort !== "cb_desc")   p.set("sort",            sort);
      const r = await fetch(`/api/reci/clawback/cases?${p.toString()}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`fetch failed (${r.status})`);
      const j = await r.json();
      setCases(j.cases || []);
      setSummary(j.summary || null);
      setBuckets(j.buckets || []);
      setWarnings(j.warnings || []);
      setRecentUploads(j.recentUploads || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, bucketFilter, warningFilter, cbDueFrom, cbDueTo, cbMin, cbMax, masterAgentNo, agentNo, surname, sourceFilter, search, sort]);

  useEffect(() => { void load(); }, [load]);

  // Backfill Notify runner (placed here so it can close over load()).
  const runBackfillNotify = useCallback(async () => {
    setBackfillBusy(true);
    try {
      const dry = await fetch("/api/reci/clawback/notify-unnotified", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dry_run: true }),
      });
      const dj = await dry.json();
      if (!dry.ok || !dj.ok) {
        alert(`Couldn't check candidates: ${dj.error || dry.statusText}`);
        return;
      }
      if (dj.candidateCount === 0) {
        alert("Nothing to notify -- every CB > 0 case already has notified_at stamped.");
        return;
      }
      const ok = window.confirm(
        `${dj.candidateCount} case${dj.candidateCount === 1 ? "" : "s"} ready to Notify. ` +
        `Recipients will be the CAM (or Tan + Hayder for Xstaff) with Guy and management on CC. ` +
        `Continue?`,
      );
      if (!ok) return;
      const r = await fetch("/api/reci/clawback/notify-unnotified", { method: "POST" });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        alert(`Notify failed: ${j.error || r.statusText}`);
        return;
      }
      const failTail = j.failed > 0 ? ` (${j.failed} failed -- see runtime logs)` : "";
      alert(`Notify backfill done. Sent ${j.sent}/${j.attempted}.${failTail}`);
      await load();
    } catch (e) {
      alert(`Notify failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBackfillBusy(false);
    }
  }, [load]);

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const f = files[0];
    if (!/\.xlsx$/i.test(f.name)) {
      setUploadResult("Only .xlsx files are supported.");
      return;
    }
    setUploading(true);
    setUploadResult(null);
    try {
      const fd = new FormData();
      fd.set("file", f);
      const r = await fetch("/api/reci/clawback/upload", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        setUploadResult(`Upload failed: ${j.error || r.statusText}`);
      } else {
        const s = j.summary;
        // Auto-notify metrics come back when at least one new case had
        // clawback_due > 0 (zero-pound cases are deliberately not
        // notified). Surface them so Pauline knows what fired.
        const notifyTail = s.autoNotifyAttempted > 0
          ? ` Notify emails: ${s.autoNotifySent}/${s.autoNotifyAttempted}` +
            (s.autoNotifyFailed > 0 ? ` (${s.autoNotifyFailed} failed -- see logs)` : "")
          : "";
        setUploadResult(
          `Ingested ${s.rowsTotal} rows from ${f.name} (report date ${s.reportDate || "n/a"}): ` +
          `${s.rowsInserted} new, ${s.rowsUpdated} updated, ${s.rowsUnchanged} unchanged, ` +
          `${s.rowsUnmatched} unmatched agents.${notifyTail}`,
        );
        await load();
      }
    } catch (e) {
      setUploadResult(`Upload failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [load]);

  const bucketTiles = buckets.filter((b) => b.cases > 0).slice(0, 8);

  return (
    <main className="mx-auto max-w-[1800px] px-4 py-4">
      <PrintHeader
        title="Clawback Dashboard"
        subtitle="Post-completion clawback tracker"
        meta={summary ? [
          { label: "Total cases", value: String(summary.total_cases) },
          { label: "Total CB due", value: gbp(summary.total_clawback_due) },
          { label: "Saved", value: gbp(summary.total_saved) },
          { label: "Net at risk", value: gbp(summary.total_net_at_risk) },
        ] : []}
      />

      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Clawback Dashboard</h1>
          <div className="text-sm text-slate-600">
            {me?.clawbackAdviserName
              ? <>Your cases: <strong className="text-slate-900">{me.clawbackAdviserName}</strong> &middot; only post-completion CB assigned to you</>
              : <>Post-completion CB tracking (L&amp;G EBAH today; more providers coming)</>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {me?.isClawbackAdmin && (
            <button
              type="button"
              onClick={() => setNewCaseOpen(true)}
              className="rounded bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
            >
              + New case
            </button>
          )}
          {me?.isClawbackAdmin && (
            <button
              type="button"
              onClick={() => void runBackfillNotify()}
              disabled={backfillBusy}
              className="rounded border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-50"
              title="Fire the Notify email on every case with CB > 0 that hasn't been notified yet"
            >
              {backfillBusy ? "Working…" : "Notify backfill"}
            </button>
          )}
          <a
            href="/reci/clawback/activity"
            className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Activity
          </a>
          <a
            href="/reci/clawback/forecast"
            className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Forecast
          </a>
          <a
            href="/reci/clawback/reports"
            className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Reports
          </a>
          <PrintButton />
        </div>
      </div>

      {/* Upload widget — admin only (Pauline + Jimmy). */}
      {me?.canUploadEbah !== false && (
      <section
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); void handleFiles(e.dataTransfer.files); }}
        className={`mt-4 rounded border-2 border-dashed p-4 transition-colors ${
          dragOver ? "border-amber-500 bg-amber-50" : "border-slate-300 bg-white"
        }`}
      >
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-slate-800">Upload an EBAH (.xlsx)</div>
            <div className="text-xs text-slate-500">
              Drop the L&amp;G EBAH file here or click to choose. Re-uploads update existing
              cases by policy number and log every changed field to history.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => void handleFiles(e.target.files)}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="rounded bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {uploading ? "Uploading..." : "Choose file"}
            </button>
          </div>
        </div>
        {uploadResult && (
          <div className="mt-3 rounded bg-slate-50 px-3 py-2 text-sm text-slate-800">
            {uploadResult}
          </div>
        )}
      </section>
      )}

      {/* Summary tiles */}
      <section className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Cases in view" value={summary ? summary.total_cases.toString() : "—"} />
        <Tile label="Clawback due £" value={summary ? gbp(summary.total_clawback_due) : "—"} />
        <Tile label="Saved £" value={summary ? gbp(summary.total_saved) : "—"} accent="green" />
        <Tile label="Net at risk £" value={summary ? gbp(summary.total_net_at_risk) : "—"} accent="amber" />
      </section>

      {/* Bucket breakdown -- only meaningful for admins / Guy seeing every
          bucket. Sellers only have one bucket (themselves) so the section
          would be a single tile of clutter. */}
      {!me?.isClawbackSeller && bucketTiles.length > 0 && (
        <section className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-5">
          {bucketTiles.map((b) => (
            <button
              key={`${b.agent_bucket}-${b.adviser_id ?? "x"}`}
              type="button"
              onClick={() => {
                setBucketFilter(b.agent_bucket);
              }}
              className="rounded border border-slate-200 bg-white p-3 text-left transition-colors hover:bg-slate-50"
              title={`Filter to ${BUCKET_LABELS[b.agent_bucket]}${b.adviser_name ? " / " + b.adviser_name : ""}`}
            >
              <div className="text-xs uppercase tracking-wide text-slate-500">
                {b.agent_bucket === "adviser" && b.adviser_name ? b.adviser_name : BUCKET_LABELS[b.agent_bucket]}
              </div>
              <div className="text-lg font-semibold">{gbp(b.clawback_due)}</div>
              <div className="text-xs text-slate-500">{b.cases} cases · net {gbp(b.net_at_risk)}</div>
            </button>
          ))}
        </section>
      )}

      {/* Filters */}
      <section className="mt-4 rounded border border-slate-200 bg-white p-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Filters</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1 text-sm"
          >
            <option value="">All statuses</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          {!me?.isClawbackSeller && (
            <select
              value={bucketFilter}
              onChange={(e) => setBucketFilter(e.target.value)}
              className="rounded border border-slate-300 px-2 py-1 text-sm"
            >
              <option value="">All agent buckets</option>
              {Object.entries(BUCKET_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          )}
          <select
            value={warningFilter}
            onChange={(e) => setWarningFilter(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1 text-sm"
            title="L&G warning category"
          >
            <option value="">All warnings</option>
            {warnings.map((w) => (
              <option key={w.warning} value={w.warning}>
                {w.warning} ({w.cases})
              </option>
            ))}
          </select>
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1 text-sm"
            title="Old / New Openwork source"
          >
            <option value="">All sources</option>
            <option value="old_ow">Old OW</option>
            <option value="new_ow">New OW</option>
            <option value="other">Other</option>
            <option value="unset">Not yet flagged</option>
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="rounded border border-slate-300 px-2 py-1 text-sm"
            title="Sort order"
          >
            {(Object.keys(SORT_LABELS) as Sort[]).map((k) => (
              <option key={k} value={k}>{SORT_LABELS[k]}</option>
            ))}
          </select>
          <input
            type="search"
            placeholder="Search name / postcode / policy / agent no..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-w-[280px] flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
          />
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
            title="More filters"
          >
            {moreOpen ? "Hide more" : "More filters"}
          </button>
          {(statusFilter || bucketFilter || warningFilter || cbDueFrom || cbDueTo || cbMin || cbMax || masterAgentNo || agentNo || surname || sourceFilter || search || sort !== "cb_desc") && (
            <button
              type="button"
              onClick={() => {
                setStatusFilter(""); setBucketFilter(""); setWarningFilter("");
                setCbDueFrom(""); setCbDueTo(""); setCbMin(""); setCbMax("");
                setMasterAgentNo(""); setAgentNo(""); setSurname("");
                setSourceFilter(""); setSearch(""); setSort("cb_desc");
              }}
              className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
            >
              Clear all
            </button>
          )}
        </div>
        {moreOpen && (
          <div className="mt-2 grid grid-cols-2 gap-2 border-t border-slate-100 pt-2 md:grid-cols-4">
            <FilterField label="Surname">
              <input
                type="text"
                value={surname}
                onChange={(e) => setSurname(e.target.value)}
                placeholder="e.g. McMinn"
                className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
              />
            </FilterField>
            <FilterField label="Master Agent No">
              <input
                type="text"
                value={masterAgentNo}
                onChange={(e) => setMasterAgentNo(e.target.value)}
                placeholder="e.g. 8674533"
                className="w-full rounded border border-slate-300 px-2 py-1 text-sm font-mono"
              />
            </FilterField>
            <FilterField label="Seller / Agent No">
              <input
                type="text"
                value={agentNo}
                onChange={(e) => setAgentNo(e.target.value)}
                placeholder="e.g. 8938722"
                className="w-full rounded border border-slate-300 px-2 py-1 text-sm font-mono"
              />
            </FilterField>
            <div />
            <FilterField label="CB date from">
              <input
                type="date"
                value={cbDueFrom}
                onChange={(e) => setCbDueFrom(e.target.value)}
                className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
              />
            </FilterField>
            <FilterField label="CB date to">
              <input
                type="date"
                value={cbDueTo}
                onChange={(e) => setCbDueTo(e.target.value)}
                className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
              />
            </FilterField>
            <FilterField label="CB £ min">
              <input
                type="number"
                min="0"
                step="0.01"
                value={cbMin}
                onChange={(e) => setCbMin(e.target.value)}
                placeholder="0"
                className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
              />
            </FilterField>
            <FilterField label="CB £ max">
              <input
                type="number"
                min="0"
                step="0.01"
                value={cbMax}
                onChange={(e) => setCbMax(e.target.value)}
                placeholder="no cap"
                className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
              />
            </FilterField>
          </div>
        )}
      </section>

      {error && (
        <div className="mt-3 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800">
          Failed to load: {error}
        </div>
      )}

      {/* Cases table */}
      <section className="mt-4 overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <Th>Client</Th>
              <Th>Postcode</Th>
              <Th>Policy No</Th>
              <Th>Master Agent</Th>
              <Th>Agent No</Th>
              <Th>Provider</Th>
              <Th>Type</Th>
              <Th>Warning</Th>
              <Th right>Premium</Th>
              <Th right>CB Due £</Th>
              <Th>CB Date</Th>
              <Th>Agent</Th>
              <Th>Bucket</Th>
              <Th>Source</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="px-3 py-6 text-center text-slate-400" colSpan={15}>Loading...</td></tr>
            ) : cases.length === 0 ? (
              <tr><td className="px-3 py-6 text-center text-slate-400" colSpan={15}>No cases match.</td></tr>
            ) : cases.map((c) => (
              <tr
                key={c.id}
                onClick={() => setOpenCase(c)}
                className="cursor-pointer border-t border-slate-100 hover:bg-amber-50"
                title="Click to open case detail"
              >
                <Td>{c.client_name}</Td>
                <Td>{c.postcode || "—"}</Td>
                <Td><code className="text-xs">{c.policy_number}</code></Td>
                <Td><code className="text-xs">{c.master_agent_no || "—"}</code></Td>
                <Td><code className="text-xs">{c.agent_no || "—"}</code></Td>
                <Td className="uppercase">{c.provider}</Td>
                <Td className="max-w-[220px] truncate" title={c.policy_type || ""}>{c.policy_type || "—"}</Td>
                <Td><WarningPill warning={c.ebah_warning} /></Td>
                <Td right>{gbp(c.net_premium)}</Td>
                <Td right className="font-medium">
                  {gbp(c.effective_clawback_due ?? c.clawback_due)}
                  {c.openwork_clawback_due !== null && (
                    <span
                      className="ml-1 inline-block rounded bg-blue-100 px-1 py-0.5 text-[10px] font-semibold uppercase text-blue-800"
                      title={`Openwork override (provider amount: ${gbp(c.clawback_due)})`}
                    >
                      OW
                    </span>
                  )}
                </Td>
                <Td>{c.clawback_date || "—"}</Td>
                <Td className="max-w-[200px] truncate" title={c.ebah_agent_name}>
                  {c.adviser_name ? <strong>{c.adviser_name}</strong> : c.ebah_agent_name}
                </Td>
                <Td><BucketPill bucket={c.agent_bucket} /></Td>
                <Td><SourcePill source={c.source} /></Td>
                <Td><StatusPill status={c.status} /></Td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Recent uploads */}
      {recentUploads.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-600">Recent uploads</h2>
          <div className="overflow-x-auto rounded border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                <tr>
                  <Th>Uploaded</Th>
                  <Th>By</Th>
                  <Th>File</Th>
                  <Th>Report date</Th>
                  <Th right>Rows</Th>
                  <Th right>New</Th>
                  <Th right>Updated</Th>
                  <Th right>Unchanged</Th>
                  <Th right>Unmatched</Th>
                </tr>
              </thead>
              <tbody>
                {recentUploads.map((u) => (
                  <tr key={u.id} className="border-t border-slate-100">
                    <Td>{new Date(u.uploaded_at).toLocaleString("en-GB")}</Td>
                    <Td>{u.uploaded_by}</Td>
                    <Td className="max-w-[280px] truncate" title={u.filename}>{u.filename}</Td>
                    <Td>{u.report_date || "—"}</Td>
                    <Td right>{u.rows_total}</Td>
                    <Td right className="text-emerald-700">{u.rows_inserted}</Td>
                    <Td right className="text-amber-700">{u.rows_updated}</Td>
                    <Td right className="text-slate-500">{u.rows_unchanged}</Td>
                    <Td right className={u.rows_unmatched > 0 ? "text-red-700" : "text-slate-500"}>{u.rows_unmatched}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {openCase && (
        <CaseDrawer
          row={openCase as DrawerCaseRow}
          canEdit={me?.canEditClawback ?? false}
          canNotify={me?.canNotifyCam ?? false}
          canEditOpenworkCb={me?.isClawbackAdmin ?? false}
          onClose={() => setOpenCase(null)}
          onChange={() => { void load(); }}
        />
      )}

      {newCaseOpen && (
        <NewCaseModal
          onClose={() => setNewCaseOpen(false)}
          onSaved={() => { void load(); }}
        />
      )}
    </main>
  );
}

function Tile({ label, value, accent }: { label: string; value: string; accent?: "green" | "amber" }) {
  const color =
    accent === "green" ? "border-emerald-200 bg-emerald-50" :
    accent === "amber" ? "border-amber-200 bg-amber-50" :
    "border-slate-200 bg-white";
  return (
    <div className={`rounded border p-3 ${color}`}>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-xs uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={`px-3 py-2 ${right ? "text-right" : "text-left"} font-medium`}>{children}</th>;
}
function Td({ children, right, className, title }: { children: React.ReactNode; right?: boolean; className?: string; title?: string }) {
  return <td title={title} className={`px-3 py-2 ${right ? "text-right" : ""} ${className || ""}`}>{children}</td>;
}

function StatusPill({ status }: { status: Status }) {
  const cls: Record<Status, string> = {
    open:       "bg-slate-100 text-slate-700",
    saved:      "bg-emerald-100 text-emerald-800",
    resold:     "bg-blue-100 text-blue-800",
    dead:       "bg-red-100 text-red-800",
    reinstated: "bg-amber-100 text-amber-800",
    closed:     "bg-slate-200 text-slate-600",
  };
  return <span className={`inline-block rounded px-2 py-0.5 text-xs ${cls[status]}`}>{STATUS_LABELS[status]}</span>;
}

function SourcePill({ source }: { source: "old_ow" | "new_ow" | "other" | null }) {
  if (!source) return <span className="text-slate-400">—</span>;
  const cls: Record<"old_ow" | "new_ow" | "other", string> = {
    old_ow: "bg-purple-50 text-purple-800 ring-1 ring-purple-200",
    new_ow: "bg-cyan-50 text-cyan-800 ring-1 ring-cyan-200",
    other:  "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
  };
  return <span className={`inline-block whitespace-nowrap rounded px-2 py-0.5 text-xs ${cls[source]}`}>{SOURCE_LABELS[source]}</span>;
}

function BucketPill({ bucket }: { bucket: Bucket }) {
  const cls: Record<Bucket, string> = {
    adviser:       "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200",
    xstaff:        "bg-amber-50 text-amber-800 ring-1 ring-amber-200",
    legacy:        "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
    needs_review:  "bg-red-50 text-red-700 ring-1 ring-red-200",
  };
  return <span className={`inline-block rounded px-2 py-0.5 text-xs ${cls[bucket]}`}>{BUCKET_LABELS[bucket]}</span>;
}

function WarningPill({ warning }: { warning: string | null }) {
  if (!warning) return <span className="text-slate-400">—</span>;
  const w = warning.toLowerCase();
  let cls = "bg-slate-100 text-slate-700";
  if (w.includes("lapse")) cls = "bg-orange-100 text-orange-800";
  else if (w.includes("bounced")) cls = "bg-red-100 text-red-800";
  else if (w.includes("cancelled")) cls = "bg-red-100 text-red-800";
  else if (w.includes("death")) cls = "bg-purple-100 text-purple-800";
  else if (w.includes("review")) cls = "bg-blue-100 text-blue-800";
  return <span className={`inline-block whitespace-nowrap rounded px-2 py-0.5 text-xs ${cls}`}>{warning}</span>;
}
