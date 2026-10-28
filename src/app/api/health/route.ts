import { NextResponse } from "next/server";
import db from "@/lib/db";
import { llmConfigured } from "@/lib/enrich";
import { telegramConfigured } from "@/lib/telegram";
import { userbotConfigured } from "@/lib/tgUser";
import { etherscanConfigured } from "@/lib/chain";

function count(table: string): number {
  return (db.prepare(`SELECT COUNT(*) c FROM ${table}`).get() as { c: number }).c;
}

function setting(key: string): string | null {
  return (db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined)?.value ?? null;
}

/** Public health check for uptime monitors (no secrets, PIN not required). */
export async function GET() {
  try {
    db.prepare("SELECT 1").get();

    const lastPoll = setting("last_poll");
    const pollAgeMin = lastPoll ? Math.round((Date.now() - Date.parse(lastPoll)) / 60000) : null;
    const sessionAlerted = Boolean(setting("tg_session_alerted"));
    // stale = pipeline macet >1 jam — balikin 503 biar uptime monitor (UptimeRobot dsb.) nge-alert
    const stale = pollAgeMin !== null && pollAgeMin > 60;

    return NextResponse.json(
      {
        ok: !stale,
        uptime_s: Math.floor(process.uptime()),
        scheduler: {
          started: Boolean(setting("scheduler_started")),
          last_poll: lastPoll,
          poll_age_min: pollAgeMin,
          poll_stale: pollAgeMin === null ? "never-polled" : stale,
        },
      counts: {
        projects: count("projects"),
        news: count("news_items"),
        opportunities: count("opportunities"),
        archived_messages: count("tg_messages"),
        tge_events: count("tge_events"),
      },
      integrations: {
        llm: llmConfigured(),
        telegram_bot: telegramConfigured(),
        tg_userbot: userbotConfigured(),
        tg_userbot_session_ok: userbotConfigured() && !sessionAlerted,
        etherscan: etherscanConfigured(),
        pin_auth: Boolean(process.env.APP_PIN),
      },
    },
      { status: stale ? 503 : 200 },
    );
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
