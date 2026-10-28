"use client";

import { useMemo, useState } from "react";
import { ecoNameFromUrl } from "@/lib/parse";
import type { ProjectView } from "@/lib/tracker";
import { useToast } from "./ui/Toast";

/** Form + ekosistem: garapan kecil di dalam garapan mainnet/testnet — punya task & streak sendiri.
 *  Nama ngisis sendiri dari link (aturan sama kayak server — parseLink), tapi tetap bisa ditimpa manual. */
export default function EcoAdd({ parent, hasKids, onAdded }: { parent: ProjectView; hasKids: boolean; onAdded: () => void }) {
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  // nama otomatis dari link — label yang dobel dengan nama induk di-skip (elysium.signal.family → Signal)
  const autoName = useMemo(() => {
    const u = url.trim();
    return u ? ecoNameFromUrl(u, parent.name) : "";
  }, [url, parent.name]);
  const displayName = nameTouched ? name : autoName;

  if (!["mainnet", "testnet"].includes(parent.category)) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) {
      toast("Isi link ekosistemnya dulu.", "warn");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: displayName.trim() || undefined, url: url.trim(), category: parent.category, parent_id: parent.id }),
    });
    setBusy(false);
    if (res.ok) {
      setName("");
      setNameTouched(false);
      setUrl("");
      onAdded();
      toast(`Ekosistem nyantol di ${parent.name}.`, "done");
    } else {
      const j = await res.json().catch(() => null);
      toast(j?.error ?? "Gagal nambah ekosistem.", "danger");
    }
  }

  const form = (
    <form onSubmit={submit} className="mt-2 flex flex-wrap gap-1.5">
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="link ekosistem… (nama ngisi sendiri dari link)"
        className="min-w-32 flex-1 rounded-md border border-border bg-bg px-2 py-1 outline-none placeholder:text-faint focus:border-accent"
      />
      <input
        value={displayName}
        onChange={(e) => {
          setName(e.target.value);
          setNameTouched(true);
        }}
        placeholder="nama (auto dari link)"
        className={`min-w-24 flex-1 rounded-md border border-border bg-bg px-2 py-1 outline-none placeholder:text-faint focus:border-accent ${
          !nameTouched && displayName ? "text-muted" : ""
        }`}
      />
      <button disabled={busy} className="rounded-md border border-border px-2 py-1 transition-colors hover:bg-surface-2 disabled:opacity-50">
        add
      </button>
    </form>
  );

  return (
    <details className="text-xs">
      <summary className="w-fit cursor-pointer font-mono text-[11px] text-faint transition-colors hover:text-accent">
        {hasKids ? "+ tambah ekosistem" : `+ ekosistem di ${parent.name}`}
      </summary>
      {form}
    </details>
  );
}
