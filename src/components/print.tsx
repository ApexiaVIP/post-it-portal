"use client";

/**
 * Reusable print primitives.
 *
 * PrintButton:  a small "Print" button. Tagged .no-print so it hides itself
 *               on the printout. Calls window.print().
 *
 * PrintHeader:  a paper-only header strip. Hidden on screen, visible only
 *               in print. Shows the report title, a "filters applied"
 *               summary, and the date/time printed so a stack of paper
 *               printouts is identifiable.
 */
import { useMemo } from "react";

export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="no-print inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
      aria-label="Print this report"
      title="Print this report"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4"
        aria-hidden="true"
      >
        <polyline points="6 9 6 2 18 2 18 9" />
        <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
        <rect x="6" y="14" width="12" height="8" />
      </svg>
      {label}
    </button>
  );
}

export interface PrintHeaderProps {
  title: string;
  subtitle?: string;
  /** Pairs of label / value rendered as a small definition list. */
  meta?: { label: string; value: string }[];
}

export function PrintHeader({ title, subtitle, meta }: PrintHeaderProps) {
  const stamp = useMemo(() => {
    const d = new Date();
    return d.toLocaleString("en-GB", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  }, []);

  return (
    <div className="print-only mb-4 border-b border-slate-400 pb-2">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <div className="text-lg font-semibold">{title}</div>
          {subtitle ? <div className="text-sm text-slate-700">{subtitle}</div> : null}
        </div>
        <div className="text-xs text-slate-600">Printed {stamp}</div>
      </div>
      {meta && meta.length > 0 ? (
        <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs">
          {meta.map((m) => (
            <div key={m.label} className="flex gap-1">
              <dt className="font-medium text-slate-700">{m.label}:</dt>
              <dd className="text-slate-800">{m.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
