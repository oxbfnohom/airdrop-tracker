import { NextResponse } from "next/server";
import db from "@/lib/db";
import { etherscanConfigured } from "@/lib/chain";

const EVM_RE = /^0x[0-9a-fA-F]{40}$/;
const SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/; // base58 Solana — case-sensitive, JANGAN di-lowercase

export async function GET() {
  const wallets = db.prepare("SELECT * FROM wallets").all();
  return NextResponse.json({ wallets, etherscan: etherscanConfigured() });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const address: string = body?.address;
  if (!address || !(EVM_RE.test(address) || SOL_RE.test(address))) {
    return NextResponse.json({ error: "alamat EVM (0x…) atau Solana tidak valid" }, { status: 400 });
  }
  db.prepare("INSERT INTO wallets (label, address) VALUES (?,?)").run(body?.label ?? "", EVM_RE.test(address) ? address.toLowerCase() : address);
  const wallets = db.prepare("SELECT * FROM wallets").all();
  return NextResponse.json({ wallets }, { status: 201 });
}
