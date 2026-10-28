const TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

export function telegramConfigured(): boolean {
  return Boolean(TOKEN && CHAT_ID);
}

export async function sendMessage(text: string): Promise<boolean> {
  if (!telegramConfigured()) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.error(`[telegram] sendMessage gagal (${res.status}):`, await res.text().catch(() => ""));
    }
    return res.ok;
  } catch {
    return false;
  }
}

/** Sama kayak sendMessage tapi balikin message_id — buat pesan yang mau di-edit belakangan. */
export async function sendAndGetId(text: string): Promise<number | null> {
  return sendAndGetIdButtons(text, undefined);
}

/** Kirim pesan dengan tombol inline — balikin message_id (null kalau gagal). */
export async function sendAndGetIdButtons(
  text: string,
  buttons: Array<Array<{ text: string; callback_data: string }>> | undefined,
): Promise<number | null> {
  if (!telegramConfigured()) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.error(`[telegram] sendAndGetId gagal (${res.status}):`, await res.text().catch(() => ""));
      return null;
    }
    const data = (await res.json()) as { result?: { message_id?: number } };
    return data.result?.message_id ?? null;
  } catch {
    return null;
  }
}

/** Edit pesan yang udah kekirim — false kalau gagal (kehapus, lewat 48 jam), pemanggil fallback ke kirim baru. */
export async function editMessageText(messageId: number, text: string): Promise<boolean> {
  if (!telegramConfigured()) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        message_id: messageId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      // konten emang udah sama (toggle no-op / auto-check tanpa perubahan) — bukan error, jangan kirim pesan baru
      if (body.includes("message is not modified")) return true;
      console.error(`[telegram] editMessageText gagal (${res.status}):`, body);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Kirim ke chat id tertentu — buat balasan command bot (chat asal command). */
export async function sendToChat(chatId: number | string, text: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.error(`[telegram] sendToChat gagal (${res.status}):`, await res.text().catch(() => ""));
    }
    return res.ok;
  } catch {
    return false;
  }
}

/** Hapus pesan bot yang udah kekirim (buat tombol Lewati). */
export async function deleteMessage(messageId: number): Promise<boolean> {
  if (!telegramConfigured()) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/deleteMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT_ID, message_id: messageId }),
      signal: AbortSignal.timeout(15000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Jawab callback_query (tombol inline) biar jam pasirnya ilang. */
export async function answerCallbackQuery(id: string, text?: string): Promise<void> {
  if (!id) return;
  try {
    await fetch(`https://api.telegram.org/bot${TOKEN}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: id, ...(text ? { text } : {}) }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    // jawaban callback gagal gak fatal
  }
}

/** Long-poll update masuk — balikin list update (kosong kalau timeout/error biasa, null kalau error serius). */
export async function getUpdates(
  offset: number,
  timeoutSec: number,
): Promise<
  | Array<{
      update_id: number;
      message?: { chat: { id: number }; text?: string };
      callback_query?: { id: string; data?: string; message?: { message_id: number }; from?: { id: number } };
    }>
  | null
> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/getUpdates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ offset, timeout: timeoutSec, allowed_updates: ["message", "callback_query"] }),
      signal: AbortSignal.timeout((timeoutSec + 10) * 1000),
    });
    if (!res.ok) {
      console.error(`[telegram] getUpdates gagal (${res.status}):`, await res.text().catch(() => ""));
      return null;
    }
    const data = (await res.json()) as {
      result?: Array<{
        update_id: number;
        message?: { chat: { id: number }; text?: string };
        callback_query?: { id: string; data?: string; message?: { message_id: number }; from?: { id: number } };
      }>;
    };
    return data.result ?? [];
  } catch {
    // network error juga "serius" — balikin null biar loop bot mundur 10 detik
    // (kalau [] malah hot-loop: fetch gagal instan, gak ada jeda antar iterasi)
    return null;
  }
}

/** Hapus webhook kalau kepasang — getUpdates 409 selamanya kalau ada webhook. Aman dipanggil kapan aja. */
export async function deleteWebhook(): Promise<void> {
  if (!TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${TOKEN}/deleteWebhook`, {
      method: "POST",
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    // gak fatal
  }
}

/** Daftarin command biar muncul di autocomplete menu bot — dipanggil sekali tiap boot. */
export async function registerBotCommands(): Promise<void> {
  if (!TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${TOKEN}/setMyCommands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        commands: [
          { command: "garapan", description: "cek garapan yang belum dikerjakan + info TGE" },
          { command: "saran", description: "saran airdrop terbaru + link garapan & pesan TG" },
          { command: "tge", description: "radar TGE 30 hari ke depan" },
          { command: "help", description: "daftar command" },
        ],
      }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    // gagal register gak fatal — command tetep jalan
  }
}
