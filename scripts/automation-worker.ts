import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const { AutomationWorker } = await import("../src/automation/worker-runtime");
  const worker = new AutomationWorker();

  process.on("SIGINT", () => worker.stop());
  process.on("SIGTERM", () => worker.stop());

  await worker.run();
}

main().catch((error) => {
  console.error(
    "[auto-bet] Worker failed to start:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
