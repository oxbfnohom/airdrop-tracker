import { NextResponse } from "next/server";
import { TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions";
import db from "@/lib/db";
import { userbotConfigured, saveSession } from "@/lib/tgUser";

// In-memory pending login (single-user app). The interactive client.start() flow
// pauses at phoneCode/password callbacks; HTTP requests resolve them.
interface PendingLogin {
  phone: string;
  client: TelegramClient;
  startPromise: Promise<void>;
  resolveCode?: (code: string) => void;
  resolvePassword?: (pw: string) => void;
  passwordSignal?: Promise<"password">;
  signalPassword?: () => void;
  lastError?: { errorMessage?: string; message?: string };
}
const pending = globalThis as unknown as { __tg_pending?: PendingLogin };

const API_ID = Number(process.env.TG_API_ID ?? 0);
const API_HASH = process.env.TG_API_HASH ?? "";

const AUTH_ERRORS: Record<string, string> = {
  PHONE_CODE_INVALID: "Kode salah. Klik \u201cKirim kode\u201d lagi buat minta kode baru.",
  PHONE_CODE_EXPIRED: "Kode kedaluwarsa. Klik \u201cKirim kode\u201d lagi.",
  PHONE_NUMBER_INVALID: "Nomor HP gak valid \u2014 pakai format internasional, mis. +628123456789",
  PHONE_NUMBER_BANNED: "Nomor ini di-ban Telegram.",
  SESSION_PASSWORD_NEEDED: "Butuh password 2FA.",
};

async function teardown(p: PendingLogin) {
  if (pending.__tg_pending === p) pending.__tg_pending = undefined;
  try {
    await p.client.destroy();
  } catch {
    // already destroyed
  }
}

/** Kick off client.start() with callbacks that wait for HTTP-driven input. */
function beginLogin(phone: string) {
  const client = new TelegramClient(new StringSession(""), API_ID, API_HASH, {
    connectionRetries: 3,
    requestRetries: 2,
  });

  const p: PendingLogin = { phone, client, startPromise: Promise.resolve() };
  p.passwordSignal = new Promise((resolve) => {
    p.signalPassword = () => resolve("password");
  });

  p.startPromise = client
    .start({
      phoneNumber: async () => phone,
      phoneCode: async () =>
        new Promise<string>((resolve) => {
          p.resolveCode = resolve;
        }),
      password: async () =>
        new Promise<string>((resolve) => {
          p.resolvePassword = resolve;
          p.signalPassword?.();
        }),
      onError: async (err: Error & { errorMessage?: string }) => {
        p.lastError = { errorMessage: err.errorMessage, message: err.message };
        return true; // stop retry loops; surface the error to the HTTP caller
      },
    })
    .then(() => undefined)
    .catch(async (err: Error & { errorMessage?: string }) => {
      p.lastError = { errorMessage: err.errorMessage, message: err.message };
      if (err.message !== "AUTH_USER_CANCEL") throw err;
      // cancelled via onError (invalid code etc.) — settle quietly, caller reads lastError
    });

  pending.__tg_pending = p;
  return p;
}

function errText(p?: PendingLogin | null): string {
  const code = p?.lastError?.errorMessage;
  return (
    (code && AUTH_ERRORS[code]) ||
    p?.lastError?.message ||
    "Login gagal — coba minta kode baru."
  );
}

/** step 1 {phone} -> code sent. step 2 {phone, code} -> verify (maybe 2FA). step 2b {phone, password} -> 2FA. */
export async function POST(req: Request) {
  if (!userbotConfigured()) {
    return NextResponse.json(
      { error: "Isi TG_API_ID dan TG_API_HASH di .env.local dulu (dari my.telegram.org/apps)" },
      { status: 400 },
    );
  }
  const body = await req.json().catch(() => null);
  const phone: string = (body?.phone ?? "").trim();
  const code: string = (body?.code ?? "").trim();
  const password: string = body?.password ?? "";
  const p = pending.__tg_pending;

  try {
    // step 2b: 2FA password for an in-flight login
    if (password && p?.resolvePassword) {
      p.resolvePassword(password);
      const timeout = new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error("timeout")), 90000),
      );
      await Promise.race([p.startPromise, timeout]);
      if (p.lastError) {
        await teardown(p);
        return NextResponse.json({ error: errText(p) }, { status: 400 });
      }
      await saveSession(p.client);
      await teardown(p);
      return NextResponse.json({ ok: true, step: "done" });
    }

    // step 2: submit the OTP code
    if (code && p && p.phone === phone && p.resolveCode) {
      p.resolveCode(code);
      const timeout = new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error("timeout")), 90000),
      );
      const settled = await Promise.race([p.startPromise, p.passwordSignal, timeout]);

      if (settled === "password") {
        return NextResponse.json({ ok: true, step: "password_needed" });
      }
      if (p.lastError) {
        await teardown(p);
        return NextResponse.json({ error: errText(p) }, { status: 400 });
      }
      await saveSession(p.client);
      await teardown(p);
      return NextResponse.json({ ok: true, step: "done" });
    }

    // step 1: request a fresh code (also resets any broken previous attempt)
    if (!phone) {
      return NextResponse.json({ error: "Nomor HP wajib diisi" }, { status: 400 });
    }
    if (p) await teardown(p);
    const fresh = beginLogin(phone);
    // sendCode happens inside start(); wait briefly for either the code callback
    // (code sent OK) or an early error
    await Promise.race([
      new Promise((resolve) => {
        const check = setInterval(() => {
          if (fresh.resolveCode || fresh.lastError) {
            clearInterval(check);
            resolve(null);
          }
        }, 100);
        setTimeout(() => {
          clearInterval(check);
          resolve(null);
        }, 20000);
      }),
    ]);
    if (fresh.lastError) {
      await teardown(fresh);
      return NextResponse.json({ error: errText(fresh) }, { status: 400 });
    }
    return NextResponse.json({ ok: true, step: "code_sent" });
  } catch (e) {
    const msg = (e as Error).message === "timeout" ? "Waktu habis — coba lagi" : ((e as Error).message ?? "login gagal");
    if (pending.__tg_pending) await teardown(pending.__tg_pending);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

/** Check login status. */
export async function GET() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'tg_user_session'").get() as
    | { value: string }
    | undefined;
  return NextResponse.json({
    configured: userbotConfigured(),
    loggedIn: Boolean(row?.value),
  });
}
