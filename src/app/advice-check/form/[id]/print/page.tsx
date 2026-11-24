"use client";

/** The completed Fact Find, laid out to print for the file. */
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { sheetFor } from "@/lib/factfind";
import { blockLines } from "@/lib/factfind/view";
import type { Data } from "@/lib/factfind/types";

interface Form { client_label: string; adviser_name: string | null; created_by: string; case_type: string; fact_find_date: string; sheet_version: string; data: Data; updated_at: string }

export default function FactFindPrintPage() {
  const id = Number(useParams<{ id: string }>().id);
  const [f, setF] = useState<Form | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    fetch(`/api/advice-check/form/${id}`, { cache: "no-store" })
      .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); setF(j.form); })
      .catch((e) => setErr(e instanceof Error ? e.message : "Couldn't load the form."));
  }, [id]);
  if (err) return <main className="p-8 text-red-700">{err}</main>;
  if (!f) return <main className="p-8 text-slate-500">Loading…</main>;
  const sheet = sheetFor(f.sheet_version);
  return (
    <main className="mx-auto max-w-4xl bg-white px-6 py-6 text-sm">
      <button type="button" onClick={() => window.print()} className="no-print mb-4 rounded bg-teal-700 px-4 py-1.5 font-semibold text-white hover:bg-teal-800">Print</button>
      <h1 className="text-xl font-bold">Fact Find: {f.client_label}</h1>
      <p className="text-slate-600">
        {f.adviser_name ?? f.created_by} · fact find call {new Date(`${f.fact_find_date}T12:00:00`).toLocaleDateString("en-GB")} · {f.case_type === "one_call" ? "one call" : "two calls"} · {sheet.title} · last saved {new Date(f.updated_at).toLocaleString("en-GB")}
      </p>
      {sheet.sections.map((s, n) => (
        <section key={s.key} className="mt-5">
          <h2 className="border-b border-slate-400 font-bold">{n + 1}. {s.title}</h2>
          <table className="mt-1 w-full table-fixed">
            <tbody>
              {s.blocks.map((b, i) => (
                b.type === "heading" ? <tr key={i}><td colSpan={2} className="pt-2 font-semibold">{b.text}</td></tr>
                  : blockLines(b, f.data).map((l, j) => (
                    <tr key={`${i}.${j}`} className="break-inside-avoid border-b border-slate-200 align-top">
                      <td className="w-1/2 py-1 pr-3 text-slate-700">{l.label}</td>
                      <td className="whitespace-pre-line py-1 font-medium">{l.value}</td>
                    </tr>
                  ))
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </main>
  );
}
