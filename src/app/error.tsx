"use client";
import { CrashScreen } from "@/components/ui/ErrorBoundary";

/** Route-level fallback: anything that escapes the workbench boundary lands here, never on a blank page. */
export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  return <CrashScreen error={error} onRetry={retry} where="route" />;
}
