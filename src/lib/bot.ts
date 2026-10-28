import db from "./db";
import { actOnOpportunity } from "./adoptOpp";
import {
  answerCallbackQuery,
  deleteMessage,
  deleteWebhook,
  editMessageText,
  getUpdates,
  registerBotCommands,
  sendToChat,
  telegramConfigured,
} from "./telegram";
import { buildGarapanPendingText, buildSaranText } from "./tracker";

declare global {
  var __bot_started: boolean | undefined;
}

const HELP = [
  "🤖 <b>COMMAND TRACKER</b>",
  "",
  "/garapan — cek garapan lo yang belum dikerjakan hari ini + info TGE",
  "/saran — saran airdrop terbaru: tier, jenis, link garapan + link pesan TG",
  "/tge — radar TGE/listing 30 hari ke depan",
  "/help — daftar command ini",
].join("\n");

/** Radar TGE dari HP — semua event yang ke-track (bukan cuma project sendiri). */
function buildTgeText(): string {
  const rows = db
    .prepare(
      `SELECT name, tge_date, note, link, project_id FROM tge_events
       WHERE tge_date IS NOT NULL AND tge_date >= date('now', 'localtime')
         AND tge_date <= date('now', 'localtime', '+30 days')
       ORDER BY tge_date ASC LIMIT 15`,
    )
    .all() as Array<{ name: string; tge_date: string; note: string; link: string; project_id: number | null }>;
  if (rows.length === 0) {
    return "Gak ada TGE yang ke-track 30 hari ke depan.\nMuncul otomatis dari berita & grup finder.";
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const lines = rows.map((r) => {
    const d = Math.round((new Date(`${r.tge_date}T00:00:00`).getTime() - today.getTime()) / 86_400_000);
    const label = d === 0 ? "🔴 HARI INI" : d === 1 ? "🟠 BESOK" : `H-${d}`;
    const mine = r.project_id ? " 🎯" : "";
    return `• <b>${escCmd(r.name)}</b>${mine} — ${r.tge_date} (${label})${r.link ? `\n  ${r.link}` : ""}`;
  });
  return `⏰ <b>RADAR TGE 30 HARI</b>\n\n${lines.join("\n")}\n\n🎯 = garapan lo sendiri.`;
}

async function handleCommand(raw: string, chatId: number): Promise<void> {
  const cmd = raw
    .trim()
    .toLowerCase()
    .replace(/^\//, "")
    .split(/[@\s]/)[0];
  let reply: string;
  if (cmd === "garapan") reply = buildGarapanPendingText();
  else if (cmd === "saran") reply = buildSaranText();
  else if (cmd === "tge") reply = buildTgeText();
  else if (cmd === "help" || cmd === "start") reply = HELP;
  else reply = `Command <code>${escCmd(cmd)}</code> gak dikenal.\n\n${HELP}`;
  await sendToChat(chatId, reply);
}

/**
 * Tombol Garap/Lewati di notifikasi Peluang.
 * Format data: "opp:garap:<id>" / "opp:lewat:<id>" — id = peluang di database.
 * Garap → jadi project di web + pesan di-edit jadi konfirmasi.
 * Lewati → kartu hilang dari web + pesan Telegram kehapus.
 */
async function handleOppCallback(data: string, cbId: string, messageId: number | undefined): Promise<void> {
  const [, verb, rawId] = data.split(":");
  const id = Number(rawId);
  if (!id) return void answerCallbackQuery(cbId, "Peluang gak ketemu.");
  const action = verb === "garap" ? "adopt" : verb === "lewat" ? "dismiss" : null;
  if (!action) return void answerCallbackQuery(cbId, "Tombol gak dikenal.");

  const r = await actOnOpportunity(id, action).catch(() => ({ ok: false, status: 500 }));
  if (!r.ok) return void answerCallbackQuery(cbId, "Gagal — cek di web.");

  if (action === "dismiss") {
    // lewati = bersih total: pesan TG kehapus, kartu web udah otomatis ilang
    if (messageId) await deleteMessage(messageId);
    await answerCallbackQuery(cbId, "Dilewati — kartunya dihapus.");
    return;
  }

  const name = (
    db.prepare("SELECT name FROM opportunities WHERE id = ?").get(id) as { name: string } | undefined
  )?.name;
  await answerCallbackQuery(cbId, "Masuk garapan ✓");
  if (messageId) {
    await editMessageText(
      messageId,
      `✅ <b>masuk garapan</b>${name ? ` — <b>${escCmd(name)}</b>` : ""}\n<i>tercatat di web, auto di-riset.</i>`,
    );
  }
}

function escCmd(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Long-poll getUpdates — nerima command + tombol dari chat lo doang (lain diabaikan).
 * Offset disimpen di settings biar aman pas restart (command gak kebolak-balik).
 */
export function startBotPolling(): void {
  if (!telegramConfigured() || globalThis.__bot_started) return;
  globalThis.__bot_started = true;

  const allowedChat = process.env.TELEGRAM_CHAT_ID || "";
  const stored = db.prepare("SELECT value FROM settings WHERE key = 'bot_update_offset'").get() as
    | { value: string }
    | undefined;
  let offset = Number(stored?.value ?? 0) || 0;

  console.log("[bot] command polling started (/garapan, /saran, /tge, /help + tombol peluang)");
  void deleteWebhook(); // kalau webhook kepasang, getUpdates 409 selamanya
  void registerBotCommands();

  void (async function loop() {
    while (true) {
      const updates = await getUpdates(offset, 25);
      if (updates === null) {
        // error serius (mis. webhook kepasang) — jangan spam, tarik napas dulu
        await new Promise((r) => setTimeout(r, 10_000));
        continue;
      }
      for (const u of updates) {
        offset = u.update_id + 1;
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('bot_update_offset', ?)").run(String(offset));
        const cb = u.callback_query;
        if (cb?.data?.startsWith("opp:")) {
          if (allowedChat && String(cb.from?.id ?? "") !== allowedChat) {
            await answerCallbackQuery(cb.id, "Bukan buat lo 😄");
            continue;
          }
          try {
            await handleOppCallback(cb.data, cb.id, cb.message?.message_id);
          } catch (e) {
            console.error("[bot] tombol peluang gagal:", e);
            await answerCallbackQuery(cb.id, "Gagal — cek di web.");
          }
          continue;
        }
        const msg = u.message;
        if (!msg?.text) continue;
        if (String(msg.chat.id) !== allowedChat) continue; // cuma chat lo yang dibales
        try {
          await handleCommand(msg.text, msg.chat.id);
        } catch (e) {
          console.error("[bot] handleCommand gagal:", e);
        }
      }
    }
  })();
}
