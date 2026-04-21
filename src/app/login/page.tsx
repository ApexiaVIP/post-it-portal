"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [username, setU] = useState("");
  const [password, setP] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({} as { error?: string }));
        setErr(j.error || "Login failed");
        return;
      }
      const from = params.get("from") || "/";
      router.replace(from);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="bg-white shadow rounded-lg p-6 w-full max-w-sm space-y-4"
    >
      <h1 className="text-xl font-semibold">POST IT Portal</h1>
      <p className="text-sm text-slate-500">Sign in to enter today&apos;s manual data.</p>

      <label className="block text-sm">
        <span className="block mb-1 font-medium">Username</span>
        <input
          className="w-full rounded border-slate-300 px-3 py-2 border"
          value={username}
          onChange={(e) => setU(e.target.value)}
          autoComplete="username"
          required
        />
      </label>

      <label className="block text-sm">
        <span className="block mb-1 font-medium">Password</span>
        <input
          className="w-full rounded border-slate-300 px-3 py-2 border"
          type="password"
          value={password}
          onChange={(e) => setP(e.target.value)}
          autoComplete="current-password"
          required
        />
      </label>

      {err && <p className="text-sm text-red-600">{err}</p>}

      <button
        type="submit"
        disabled={busy}
        className="w-full bg-slate-900 text-white rounded py-2 font-medium hover:bg-slate-800 disabled:opacity-60"
      >
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <Suspense fallback={<div className="text-slate-500">Loading…</div>}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
