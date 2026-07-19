import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    ok: true,
    service: "big-beautiful-betting-monitor",
    version: process.env.APP_VERSION || "development",
  });
}
