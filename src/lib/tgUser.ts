import { TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions";
import db from "./db";

/**
 * Telegram userbot: reads chats the logged-in account has joined
 * (public channels AND groups — groups have no web preview, so this is
 * the only way to watch community/finders groups).
 *
 * All messages land in `tg_messages` (14-day rolling archive). The news
 * pipeline dedupes against news_items/opportunities; project add does a
 * backfill scan against this archive so late finder mentions are found.
 */

const API_ID = Number(process.env.TG_API_ID ?? 0);
const API_HASH = process.env.TG_API_HASH ?? "";

export function userbotConfigured(): boolean {
  return Boolean(API_ID && API_HASH);
}

function loadSession(): { session: StringSession; saved: string | null } {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'tg_user_session'").get() as
    | { value: string }
    | undefined;
  const saved = row?.value ?? null;
  return { session: new StringSession(saved ?? ""), saved };
}

export async function makeClient(): Promise<{ client: TelegramClient; hadSession: boolean } | null> {
  if (!userbotConfigured()) return null;
  const { session, saved } = loadSession();
  const client = new TelegramClient(session, API_ID, API_HASH, {
    connectionRetries: 3,
    requestRetries: 3,
  });
  await client.connect();
  const hadSession = Boolean(saved) && (await client.isUserAuthorized());
  return { client, hadSession };
}

export async function saveSession(client: TelegramClient): Promise<void> {
  const s = client.session.save() as unknown as string;
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('tg_user_session', ?)").run(String(s));
}

export interface TgMessage {
  chat: string;
  chatTitle: string;
  id: number;
  text: string;
  date: Date;
  link: string;
  reactions?: number;
  replies?: number;
  /** ada foto yang belum ke-OCR — pipeline berita download & baca teksnya via vision LLM */
  photoPending?: boolean;
}

interface ChatEntity {
  username?: string;
  title?: string;
  className?: string;
  id?: unknown;
}

/** Archive every message from every joined chat into tg_messages (newest last). */
export async function archiveJoinedChats(
  limitPerChat = 20,
): Promise<{ messages: TgMessage[]; sessionLost: boolean }> {
  const made = await makeClient();
  if (!made) return { messages: [], sessionLost: false };
  const { client, hadSession } = made;
  if (!hadSession) {
    await client.destroy();
    // a saved session that no longer authorizes = logged out elsewhere / revoked
    return { messages: [], sessionLost: Boolean(loadSession().saved) };
  }

  const messages: TgMessage[] = [];
  try {
    const dialogs = await client.getDialogs({ limit: 200 });
    for (const d of dialogs) {
      const entity = d.entity as ChatEntity;
      const username = entity?.username;
      if (!username) continue;

      try {
        const msgs = await client.getMessages(d.entity, { limit: limitPerChat });
        for (const m of msgs) {
          const text = (m.message ?? "").trim();
          const media = m as unknown as { photo?: { id?: unknown } };
          // pesan ber-foto tetap diarsip walau teksnya kosong — poster garapan
          // sering cuma gambar; teksnya di-OCR di pipeline berita (sekali saja)
          if (!text && !media.photo) continue;
          const link = `https://t.me/${username}/${m.id}`;
          // engagement: total reaksi emoji + jumlah reply (kalau lib-nya ngasih)
          const raw = m as unknown as {
            reactions?: { results?: Array<{ count?: number }> };
            replies?: { replies?: number };
          };
          const reactions = raw.reactions?.results?.reduce((n, r) => n + (r.count ?? 0), 0) ?? 0;
          const replies = raw.replies?.replies ?? 0;
          messages.push({
            chat: username,
            chatTitle: entity?.title ?? username,
            id: m.id,
            text,
            date: m.date ? new Date(m.date * 1000) : new Date(),
            link,
            reactions,
            replies,
            photoPending: !text && Boolean(media.photo),
          });
        }
      } catch {
        // skip unreadable chats
      }
    }

    const stmt = db.prepare(
      "INSERT INTO tg_messages (chat, chat_title, text, link, date, reactions, replies) VALUES (?,?,?,?,?,?,?) " +
        "ON CONFLICT(link) DO UPDATE SET reactions = excluded.reactions, replies = excluded.replies",
    );
    // keep 6 bulan doang — sama persis dengan window retensi. Lebih lama cuma
    // buang kerjaan: job retensi tiap hari ngehapus pesan >180 hari.
    const cutoff = Date.now() - 180 * 24 * 3600 * 1000;
    let n = 0;
    const tx = db.transaction((msgs: TgMessage[]) => {
      for (const m of msgs) {
        if (m.date.getTime() < cutoff) continue;
        const r = stmt.run(
          m.chat,
          m.chatTitle,
          m.text,
          m.link,
          m.date.toISOString().replace("T", " ").slice(0, 19),
          m.reactions ?? 0,
          m.replies ?? 0,
        );
        n += r.changes;
      }
    });
    tx(messages);
    db.prepare("DELETE FROM tg_messages WHERE date IS NULL OR date < datetime('now', '-180 days')").run();
    if (n > 0) console.log(`[tg-archive] +${n} messages (${messages.length} scanned)`);
    return { messages, sessionLost: false };
  } finally {
    await client.destroy();
  }
}

/** Deep scan: pull long history from every joined chat (one-time per add, heavy). */
export async function deepArchiveChats(limitPerChat = 2000): Promise<number> {
  const { messages } = await archiveJoinedChats(limitPerChat);
  return messages.length;
}

/**
 * Download foto pesan → base64 JPEG — buat di-OCR pipeline berita.
 * Nyala client userbot sebentar (bikin-destroy), jadi dipanggil hemat
 * (cuma pesan foto yang belum ke-OCR).
 */
export async function downloadPhoto(chat: string, messageId: number): Promise<string | null> {
  if (!userbotConfigured()) return null;
  let client: TelegramClient | null = null;
  try {
    const made = await makeClient();
    if (!made || !made.hadSession) return null;
    client = made.client;
    const entity = await client.getEntity(chat);
    const msgs = await client.getMessages(entity, { ids: [messageId] });
    const m = msgs?.[0];
    if (!m) return null;
    const buf = (await m.downloadMedia()) as unknown as Buffer | undefined;
    if (!buf || !buf.length) return null;
    return `data:image/jpeg;base64,${buf.toString("base64")}`;
  } catch {
    return null;
  } finally {
    await client?.destroy();
  }
}
