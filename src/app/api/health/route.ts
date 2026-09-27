import { NextResponse } from "next/server";
import { getAutomationStore } from "@/automation/store";
import { workerHealth } from "@/lib/automation-status";

export const dynamic = "force-dynamic";
export function GET() {
  try {
    const snapshot = getAutomationStore().getSnapshot();
    const worker = workerHealth(snapshot);
    return NextResponse.json(
      {
        ok: worker.alive,
        service: "big-beautiful-betting-monitor",
        version: process.env.APP_VERSION || "development",
        storage: "ready",
        worker,
      },
      {
        status: worker.alive ? 200 : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch {
    return NextResponse.json(
      {
        ok: false,
        service: "big-beautiful-betting-monitor",
        storage: "unavailable",
      },
      { status: 503 },
    );
  }
}
