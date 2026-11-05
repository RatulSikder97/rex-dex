import Workbench from "@/components/workbench/Workbench";
import { AppErrorBoundary } from "@/components/ui/ErrorBoundary";

export default function Page() {
  return (
    <AppErrorBoundary>
      <Workbench />
    </AppErrorBoundary>
  );
}
