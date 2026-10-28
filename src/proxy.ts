import { NextResponse, type NextRequest } from "next/server";

const PUBLIC = ["/login", "/api/login", "/api/health"];

async function expectedToken(): Promise<string> {
  const pin = process.env.APP_PIN ?? "";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`at:${pin}`));
  return Array.from(new Uint8Array(digest.slice(0, 16)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export default async function proxy(req: NextRequest) {
  const pin = process.env.APP_PIN;
  if (!pin) return NextResponse.next(); // auth disabled (local dev)

  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p)) return NextResponse.next();

  // external cron (VPS crontab) may call /api/cron/* with a bearer token
  const cronToken = process.env.CRON_TOKEN;
  if (cronToken && pathname.startsWith("/api/cron/")) {
    if (req.headers.get("authorization") === `Bearer ${cronToken}`) return NextResponse.next();
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const authCookie = req.cookies.get("at_auth")?.value;
  if (authCookie && authCookie === (await expectedToken())) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
