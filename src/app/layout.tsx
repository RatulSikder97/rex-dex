import type { Metadata, Viewport } from "next";
import { THEME_BOOT_SCRIPT } from "@/components/ui/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "REX Workbench",
  description: "One-person company OS — plan, build, ship, and market with AI departments.",
};

export const viewport: Viewport = {
  colorScheme: "dark light",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        {/* Applies the saved theme (dark | light | system) before first paint. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
