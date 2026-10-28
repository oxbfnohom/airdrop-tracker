/**
 * Satu pintu buat semua panggilan LLM — hemat + tahan banting.
 *
 * Urutan provider (yang pertama sukses dipakai terus, mati = pindah otomatis):
 *   1. OpenRouter model :free (butuh OPENROUTER_API_KEY — gratis daftar)
 *   2. Proxy lokal (LLM_BASE_URL punya teman, channel gratis)
 *
 * - Panggilan teks pakai *_TEXT_MODELS, panggilan foto/OCR pakai *_VISION_MODELS.
 * - Timeout per-percobaan pendek biar channel nge-hang cepet dilewatin.
 * - Pemakaian dicatat per hari di settings (llm_usage_YYYY-MM-DD) biar kelihatan
 *   seberapa "hemat" dan mendekati limit gratis OpenRouter (50/hari tanpa topup,
 *   1000/hari kalau pernah beli kredit $10 sekali saja).
 */

const LOCAL_BASE = (process.env.LLM_BASE_URL || "").replace(/\/$/, "");
const LOCAL_KEY = process.env.LLM_API_KEY || "";
const OR_KEY = process.env.OPENROUTER_API_KEY || "";
const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
// Kill-switch biar semua fitur LLM bisa dimatiin tanpa ngebuang key:
// set LLM_ENABLED=0 di .env.local → semua jalur LLM mati (heuristic pipeline jalan)
const LLM_ENABLED = process.env.LLM_ENABLED !== "0";
// Anggaran harian — credit gak boncos kalau LLM nyala lagi. 0 = tanpa limit.
// Default 40 pas: OpenRouter gratis 50/hari, jadi mode hemat=gak mepet kuota.
const DAILY_BUDGET = Number(process.env.LLM_DAILY_BUDGET ?? "40");

// model yang reasoning-nya harus dimatikan eksplisit (server vLLM: chat_template_kwargs).
// Contoh: DeepSeek V4.1 Flash — tanpa ini seluruh max_tokens telanjang buat reasoning
// dan balasannya content=null (gak pernah selesai mikir).
const NO_THINK = new Set(split(process.env.LLM_NO_THINK));

export function llmConfigured(): boolean {
  return LLM_ENABLED && (Boolean(LOCAL_BASE) || Boolean(OR_KEY));
}

function split(raw: string | undefined): string[] {
  return (raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

interface Provider {
  nama: string;
  base: string;
  key: string;
  models: string[];
  visionModels: string[];
  sticky: number; // indeks model terakhir yang sukses di provider ini
}

let providerCache: Provider[] | null = null;

function buildProviders(): Provider[] {
  // cache 1x per proses — biar sticky model bisa nempel antar panggilan
  if (providerCache) return providerCache;
  const list: Provider[] = [];
  if (OR_KEY) {
    list.push({
      nama: "openrouter",
      base: "https://openrouter.ai/api/v1",
      key: OR_KEY,
      models: split(process.env.OPENROUTER_TEXT_MODELS),
      visionModels: split(process.env.OPENROUTER_VISION_MODELS),
      sticky: 0,
    });
  }
  if (GEMINI_KEY) {
    // AI Studio key gratisan — depat OpenRouter-mu habis kuota, ini kedua
    const models = split(process.env.GEMINI_TEXT_MODELS).length
      ? split(process.env.GEMINI_TEXT_MODELS)
      : ["gemini-2.5-flash"];
    list.push({
      nama: "gemini",
      base: "https://generativelanguage.googleapis.com/v1beta/openai",
      key: GEMINI_KEY,
      models,
      visionModels: split(process.env.GEMINI_VISION_MODELS).length ? split(process.env.GEMINI_VISION_MODELS) : models,
      sticky: 0,
    });
  }
  if (LOCAL_BASE) {
    const models = split(process.env.LLM_MODELS || process.env.LLM_MODEL);
    list.push({
      nama: "proxy",
      base: LOCAL_BASE,
      key: LOCAL_KEY,
      models,
      // model proxy yang bisa baca foto — kalau gak diset, pakai daftar biasa
      visionModels: split(process.env.LLM_VISION_MODELS).length ? split(process.env.LLM_VISION_MODELS) : models,
      sticky: 0,
    });
  }
  providerCache = list;
  return list;
}

export interface LlmMessage {
  role: string;
  content: unknown;
}

export interface LlmChatOpts {
  messages: LlmMessage[];
  max_tokens?: number;
  json?: boolean; // pakai response_format json_object
  vision?: boolean; // panggilan baca foto/OCR — pakai model yang support image
  timeoutMs?: number; // timeout per percobaan per model
}

/* ---------------- pencatatan pemakaian per hari ---------------- */

let usageDay = "";
let usage = { calls: 0, ok: 0, fail: 0 };

function loadUsage(dbLike: unknown): void {
  try {
    const db = dbLike as {
      prepare: (sql: string) => { get: (...args: unknown[]) => { value?: string } | undefined };
    };
    const day = new Date().toISOString().slice(0, 10);
    if (day === usageDay) return;
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(`llm_usage_${day}`);
    if (row?.value) usage = JSON.parse(row.value);
    else usage = { calls: 0, ok: 0, fail: 0 };
    usageDay = day;
  } catch {
    usageDay = new Date().toISOString().slice(0, 10);
  }
}

/** Dipanggil sekali dari scheduler/init — nyambungin counter ke sqlite. */
let usageDb: unknown = null;
export function initLlmUsage(db: unknown): void {
  usageDb = db;
}

function recordUsage(ok: boolean): void {
  usage.calls++;
  if (ok) usage.ok++;
  else usage.fail++;
  try {
    const db = usageDb as {
      prepare: (sql: string) => { run: (...args: unknown[]) => unknown };
    };
    if (!db || !usageDay) return;
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
      `llm_usage_${usageDay}`,
      JSON.stringify(usage),
    );
  } catch {
    /* counter gak boleh ganggu pipeline */
  }
}

/* ---------------- panggilan utama ---------------- */

/** Response /chat/completions (raw text), atau null kalau semua model gagal. */
/* Provider yang kena 429 (limit/kouta abis) diistirahatkan 10 menit —
   biar tiap panggilan berikutnya gak buang 4 percobaan kosong di provider itu. */
const cooldown = new Map<string, number>();
const COOLDOWN_MS = 10 * 60 * 1000;

export async function llmChat(opts: LlmChatOpts): Promise<string | null> {
  const providers = buildProviders();
  if (!providers.length) return null;
  loadUsage(usageDb);
  if (DAILY_BUDGET > 0 && usage.calls >= DAILY_BUDGET) {
    console.log(`[llm] budget harian abis (${usage.calls}/${DAILY_BUDGET}) — sisa panggilan di-skip`);
    return null;
  }
  for (const p of providers) {
    if ((cooldown.get(p.nama) ?? 0) > Date.now()) {
      console.log(`[llm] ${p.nama} lagi cooldown — skip`);
      continue;
    }
    const models = opts.vision ? p.visionModels : p.models;
    if (!models.length) continue;
    for (let i = 0; i < models.length; i++) {
      const idx = (p.sticky + i) % models.length;
      const t0 = Date.now();
      try {
        const res = await fetch(`${p.base}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(p.key ? { Authorization: `Bearer ${p.key}` } : {}),
          },
          body: JSON.stringify({
            model: models[idx],
            max_tokens: opts.max_tokens ?? 2000,
            stream: false,
            ...(opts.json ? { response_format: { type: "json_object" } } : {}),
            // model vLLM tertentu butuh thinking dimatiin, sisanya gak perlu
            ...(NO_THINK.has(models[idx]) ? { chat_template_kwargs: { thinking: false } } : {}),
            messages: opts.messages,
          }),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 45000),
        });
        if (!res.ok) {
          recordUsage(false);
          if (res.status === 429 || res.status === 402) {
            // bedain: kuota harian abis (tidur 10 menit) vs limit rate per-menit
            // (burst scan — tidur 1 menit aja, kuota sebenernya masih ada)
            const body = await res.text().catch(() => "");
            const harian = res.status === 402 || /per[_-]?day|daily|free-models-per-day/i.test(body);
            const ms = harian ? COOLDOWN_MS : 60_000;
            cooldown.set(p.nama, Date.now() + ms);
            console.log(
              `[llm] ${p.nama}/${models[idx]} kena ${res.status} (${harian ? "kuota harian" : "limit rate"}) — tidur ${Math.round(ms / 1000)}s`,
            );
            break;
          }
          console.log(`[llm] ${p.nama}/${models[idx]} gagal HTTP ${res.status} ${Date.now() - t0}ms`);
          continue; // channel ini tolak (limit/mati) — coba model berikutnya
        }
        const text = await res.text();
        if (!text.trim()) {
          recordUsage(false);
          console.log(`[llm] ${p.nama}/${models[idx]} balas kosong ${Date.now() - t0}ms`);
          continue;
        }
        // anti-model-bodoh: mode JSON tapi balasannya kosong / bukan JSON = tolak,
        // otomatis pindah ke model berikutnya
        if (opts.json) {
          const parsed = parseChatJson(text);
          if (!parsed?.content || !parsed.content.includes("{")) {
            recordUsage(false);
            console.log(`[llm] ${p.nama}/${models[idx]} balasannya bukan JSON — lewati`);
            continue;
          }
        }
        p.sticky = idx; // sukses — lengket di model ini
        recordUsage(true);
        console.log(`[llm] ${p.nama}/${models[idx]} ok ${Date.now() - t0}ms`);
        return text;
      } catch {
        recordUsage(false);
        console.log(`[llm] ${p.nama}/${models[idx]} timeout atau error jaringan — lompat`);
        continue; // timeout/error jaringan — pindah channel
      }
    }
  }
  console.error("[llm] semua provider/model gagal");
  return null;
}

/**
 * Parse defensif: kadang JSON bersih, kadang ada jejak stream di belakang
 * ("data: [DONE]"), kadang response-nya format SSE "data: {...}".
 * Kalau SSE, gabungin delta jadi teks utuh.
 */
export function parseChatJson(text: string): { content: string } | null {
  const stripped = String(text).replace(/data:\s*\[DONE\][\s\S]*$/, "").trim();
  const lastBrace = stripped.lastIndexOf("}");
  if (lastBrace > 0) {
    try {
      const d = JSON.parse(stripped.slice(0, lastBrace + 1));
      const msg = d?.choices?.[0]?.message ?? {};
      // model reasoning kadang naruh isi di reasoning_content, content cuma think-tag
      const rc = typeof msg.reasoning_content === "string" && /[{"[]/.test(msg.reasoning_content) ? msg.reasoning_content : "";
      const c = String(msg.content ?? "")
        .replace(/<think>[\s\S]*?<\/think>/gi, "")
        .trim();
      const isi = c || rc;
      if (isi) return { content: isi };
      return { content: "" };
    } catch {
      /* jatuh ke mode SSE di bawah */
    }
  }
  if (/^\s*data:/.test(stripped)) {
    let acc = "";
    for (const line of stripped.split(/\r?\n/)) {
      const c = line.replace(/^\s*data:\s*/, "").trim();
      if (!c || c === "[DONE]") continue;
      try {
        const d = JSON.parse(c);
        const delta = d?.choices?.[0]?.delta?.content;
        const msg = d?.choices?.[0]?.message?.content;
        acc += String(msg ?? delta ?? "");
      } catch {
        /* baris rusak — skip */
      }
    }
    return acc ? { content: acc } : null;
  }
  return null;
}
