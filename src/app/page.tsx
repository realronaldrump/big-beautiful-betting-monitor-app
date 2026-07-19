import { Dashboard } from "@/components/dashboard";
import { getAutomationStore } from "@/automation/store";
import { getMockDashboard } from "@/lib/mock-data";
import {
  getDashboardSnapshot,
  publicErrorMessage,
} from "@/lib/polymarket-us";

export const dynamic = "force-dynamic";

async function loadInitialDashboard() {
  try {
    const snapshot = await getDashboardSnapshot();
    return { snapshot, error: "" };
  } catch (error) {
    return {
      snapshot: getMockDashboard(),
      error: publicErrorMessage(error),
    };
  }
}

export default async function Home() {
  const { snapshot, error } = await loadInitialDashboard();
  const automation = getAutomationStore().getSnapshot();
  return (
    <Dashboard
      initialSnapshot={snapshot}
      initialAutomation={automation}
      initialError={error}
    />
  );
}
