import { NextResponse } from "next/server";
import {
  getDashboardSnapshot,
  publicErrorMessage,
} from "@/lib/polymarket-us";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const forceDemo = new URL(request.url).searchParams.get("demo") === "1";

  try {
    const snapshot = await getDashboardSnapshot(forceDemo);
    return NextResponse.json(snapshot, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    console.error("Polymarket US portfolio request failed", error);
    return NextResponse.json(
      { error: publicErrorMessage(error) },
      {
        status: 502,
        headers: { "Cache-Control": "private, no-store, max-age=0" },
      },
    );
  }
}
