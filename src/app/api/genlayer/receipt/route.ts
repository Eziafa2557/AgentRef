import { NextResponse } from "next/server";
import { readOnChainReceipt } from "@/core/genlayer/runtime";

// Always read the live contract at request time — never prerender a snapshot.
export const dynamic = "force-dynamic";

export async function GET() {
  const out = await readOnChainReceipt();
  return NextResponse.json(out);
}
