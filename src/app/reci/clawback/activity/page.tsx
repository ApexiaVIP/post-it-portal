"use client";

/**
 * Clawback Activity feed.
 *
 * Cross-case audit trail Pauline + Guy can scan to see what's been done
 * (or not done) across every clawback case. Default view: last 7 days,
 * every event type, every seller. Filter by day window, event type
 * (status changes only / emails only / etc), and seller bucket.
 *
 * Each row links back to the main dashboard with the policy number
 * pre-filled in the search box so clicking jumps straight to the case
 * drawer.
 */
import { useCallback, useEffect, useState } from "react";
import { PrintButton, PrintHeader } from "@/components/print";

interface EventRow {
  event_id: number;
  case_id: number;
  event_type: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  amount: number | null;
  money_kind: string | null;
  note: string | null;
  actor: string;
  created_at: string;
  policy_number: string;
  client_name: string;
  postcode: string | null;
  provider: string;
  ebah_warning: string | null;
  status: string;
  clawback_due: number | null;
  effective_cb: number | null;
  agent_bucket: string;
  adviser_id: number | null;
  adviser_name: string | null;
}
interface TileRow { event_type: string; n: number; }
interface SellerRow {
  adviser_id: number | null;
  agent_bucket: string;
  adviser_name: string | null;
  events: number;
}
interface ActivityResp {
  days: number;
  events: EventRow[];
  tiles: TileRow[];
  sellers: SellerRow[];
}

const EVENT_LABELS: Record<string, string> = {
  created:          "Case created",
  ebah_change:      "EBAH change",
  status_change:    "Status change",
  note:             "Note",
  contact_attempt:  "Contact",
  money_off:        "Money off",
  email_sent:       "Email sent",
};
const EVENT_CLS: Record<string, string> = {
  created:         "bg-slate-100 text-slate-700",
  ebah_change:     "bg-amber-100 text-amber-800",
  status_change:   "bg-blue-100 text-blue-800",
  note:            "bg-slate-100 text-slate-700",
  contact_attempt: "bg-cyan-100 text-cyan-800",
  money_off:       "bg-emerald-100 text-emerald-800",
  email_sent:      "bg-purple-100 text-purple-800",
};

function gbp(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function ClawbackActivityPage() {
  const [data, setData] = useState<ActivityResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [days, setDays]               = useState(7);
  const [eventType, setEventType]     = useState<string>("");
  const [adviser, setAdviser]         = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const p = new URLSearchParams();
      p.set("days", String(days));
      if (eventType) p.set("event_type", eventType);
      if (adviser)   p.set("adviser",    adviser);
      const r = await fetch(`/api/reci/clawback/activity?${p.toString()}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`fetch failed (${r.status})`);
      setData(await r.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [days, eventType, adviser]);
  useEffect(() => { void load(); }, [load]);

  const totalEvents = data?.tiles.reduce((acc, t) => acc + t.n, 0) ?? 0;
  const tileSorted = data?.tiles.slice().sort((a, b) => b.n - a.n) ?? [];

  return (
    <main className="mx-auto max-w-[1600px] px-4 py-4">
      <PrintHeader
        title="Clawback activity"
        subtitle={`Last ${days} day${days === 1 ? "" : "s"} · ${totalEvents} event${totalEvents === 1 ? "" : "s"}`}
        meta={tileSorted.slice(0, 6).map((t) => ({ label: EVENT_LABELS[t.event_type] || t.event_type, value: String(t.n) }))}
      />

      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Clawback activity</h1>
          <div className="text-sm text-slate-600">
            Everything that's happened across every case, newest first.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a href="/reci/clawback" className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100">Dashboard</a>
          <a href="/reci/clawback/forecast" className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100">Forecast</a>
          <a href="/reci/clawback/reports" className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100">Reports</a>
          <PrintButton />
        </div>
      </div>

      {/* Filters */}
      <section className="no-print mt-4 flex flex-wrap items-center gap-2 rounded border border-slate-200 bg-white p-2">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Window</span>
        <div className="inline-flex rounded border border-slate-300 bg-white">
          {[1, 7, 30, 90, 0].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={`px-3 py-1 text-sm ${days === d ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"}`}
            >
              {d === 0 ? "All time" : d === 1 ? "Today" : `${d}d`}
            </button>
          ))}
        </div>
        <span className="ml-3 text-xs font-medium uppercase tracking-wide text-slate-500">Event</span>
        <select
          value={eventType}
          onChange={(e) => setEventType(e.target.value)}
          className="rounded border border-slate-300 px-2 py-1 text-sm"
        >
          <option value="">All events</option>
          {Object.entries(EVENT_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <span className="ml-3 text-xs font-medium uppercase tracking-wide text-slate-500">Seller</span>
        <select
          value={adviser}
          onChange={(e) => setAdviser(e.target.value)}
          className="rounded border border-slate-300 px-2 py-1 text-sm"
        >
          <option value="">All sellers</option>
          {data?.sellers.map((s) => {
            const key = s.adviser_id !== null ? String(s.adviser_id) : s.agent_bucket;
            const label = s.adviser_name || (s.agent_bucket === "xstaff" ? "Xstaff" : s.agent_bucket === "legacy" ? "Legacy" : "Needs review");
            return <option key={`${key}-${label}`} value={key}>{label} ({s.events})</option>;
          })}
        </select>
        {(eventType || adviser || days !== 7) && (
          <button
            type="button"
            onClick={() => { setDays(7); setEventType(""); setAdviser(""); }}
            className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
          >
            Reset
          </button>
        )}
      </section>

      {/* Event type tiles */}
      {tileSorted.length > 0 && (
        <section className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
          {(Object.keys(EVENT_LABELS) as string[]).map((k) => {
            const t = data?.tiles.find((x) => x.event_type === k);
            const n = t?.n ?? 0;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setEventType(eventType === k ? "" : k)}
                className={`rounded border p-3 text-left transition-colors ${
                  eventType === k
                    ? "border-slate-900 bg-slate-100"
                    : "border-slate-200 bg-white hover:bg-slate-50"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`inline-block rounded px-2 py-0.5 text-xs ${EVENT_CLS[k]}`}>{EVENT_LABELS[k]}</span>
                </div>
                <div className="mt-1 text-xl font-semibold">{n}</div>
              </button>
            );
          })}
        </section>
      )}

      {error && (
        <div className="mt-3 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800">
          Failed to load: {error}
        </div>
      )}

      {/* Event list */}
      <section className="mt-4 overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left font-medium">When</th>
              <th className="px-3 py-2 text-left font-medium">Event</th>
              <th className="px-3 py-2 text-left font-medium">Detail</th>
              <th className="px-3 py-2 text-left font-medium">Client</th>
              <th className="px-3 py-2 text-left font-medium">Policy</th>
              <th className="px-3 py-2 text-left font-medium">Seller</th>
              <th className="px-3 py-2 text-right font-medium">CB £</th>
              <th className="px-3 py-2 text-left font-medium">Actor</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="px-3 py-6 text-center text-slate-400" colSpan={8}>Loading…</td></tr>
            ) : !data || data.events.length === 0 ? (
              <tr><td className="px-3 py-6 text-center text-slate-400" colSpan={8}>No activity matches.</td></tr>
            ) : data.events.map((e) => (
              <tr key={e.event_id} className="border-t border-slate-100 hover:bg-amber-50">
                <td className="whitespace-nowrap px-3 py-2 text-slate-700">{new Date(e.created_at).toLocaleString("en-GB")}</td>
                <td className="px-3 py-2">
                  <span className={`inline-block whitespace-nowrap rounded px-2 py-0.5 text-xs ${EVENT_CLS[e.event_type] || "bg-slate-100 text-slate-700"}`}>
                    {EVENT_LABELS[e.event_type] || e.event_type}
                  </span>
                </td>
                <td className="max-w-[420px] px-3 py-2 text-slate-700">
                  <EventDetail e={e} />
                </td>
                <td className="px-3 py-2 text-slate-700">{e.client_name}</td>
                <td className="px-3 py-2">
                  <a
                    href={`/reci/clawback?q=${encodeURIComponent(e.policy_number)}`}
                    className="font-mono text-xs text-blue-700 underline-offset-2 hover:underline"
                  >
                    {e.policy_number}
                  </a>
                </td>
                <td className="px-3 py-2 text-slate-700">
                  {e.adviser_name || (e.agent_bucket === "xstaff" ? "Xstaff" : e.agent_bucket === "legacy" ? "Legacy" : "—")}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-700">{gbp(e.effective_cb)}</td>
                <td className="px-3 py-2 text-slate-500">{e.actor}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}

function EventDetail({ e }: { e: EventRow }) {
  if (e.event_type === "status_change") {
    return (
      <span>
        <s className="text-slate-400">{e.old_value}</s>
        {" → "}
        <strong>{e.new_value}</strong>
        {e.note ? <> · <span className="text-slate-500">{e.note}</span></> : null}
      </span>
    );
  }
  if (e.event_type === "ebah_change") {
    return (
      <span>
        <code className="text-xs">{e.field}</code>:
        {" "}<s className="text-slate-400">{e.old_value || "—"}</s>
        {" → "}<strong>{e.new_value || "—"}</strong>
      </span>
    );
  }
  if (e.event_type === "money_off") {
    return (
      <span>
        <strong>{gbp(e.amount)}</strong>
        {" "}<span className="text-slate-500">({e.money_kind})</span>
        {e.note ? <> · {e.note}</> : null}
      </span>
    );
  }
  if (e.event_type === "email_sent" || e.event_type === "note" || e.event_type === "contact_attempt" || e.event_type === "created") {
    return <span>{e.note || EVENT_LABELS[e.event_type]}</span>;
  }
  return <span className="text-slate-500">{e.note || e.event_type}</span>;
}
