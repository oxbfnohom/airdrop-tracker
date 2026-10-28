import { NextResponse } from "next/server";
import { pollNews } from "@/lib/news";

export async function POST() {
  const inserted = await pollNews();
  return NextResponse.json({ inserted });
}
