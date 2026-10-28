import { NextResponse } from "next/server";
import { runOnchainCheck } from "@/lib/tracker";

export async function POST() {
  const lines = await runOnchainCheck();
  return NextResponse.json({ checked: true, lines });
}
