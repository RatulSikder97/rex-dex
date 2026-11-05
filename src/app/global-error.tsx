"use client";
import { THEME_BOOT_SCRIPT } from "@/components/ui/theme";
import { CrashScreen } from "@/components/ui/ErrorBoundary";
import "./globals.css";

/** Root-layout failure: renders its own document, re-applying the saved theme before paint. */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <title>REX</title>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        <CrashScreen error={error} onRetry={retry} where="root layout" />
      </body>
    </html>
  );
}
