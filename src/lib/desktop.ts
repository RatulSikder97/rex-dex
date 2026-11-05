/**
 * Bridge to the Electron shell (desktop/app/preload.js). `window.rexDesktop` only
 * exists inside the REX desktop app; every caller must handle `null` (web/dev mode).
 */

export interface NativeMenuItem {
  id?: string;
  label?: string;
  type?: "separator" | "header" | "submenu";
  hint?: string;
  checked?: boolean;
  disabled?: boolean;
  items?: NativeMenuItem[];
}

export interface NativeMenu {
  id: string;
  label: string;
  items: NativeMenuItem[];
}

export interface RexDesktop {
  isDesktop: true;
  platform: "darwin" | "win32" | "linux";
  version: string;
  /** Native "choose folder" dialog; resolves null when cancelled. */
  pickFolder(opts?: { title?: string; message?: string; defaultPath?: string | null; buttonLabel?: string }): Promise<string | null>;
  /** OS notification; the shell skips it while the REX window is focused. */
  notify(title: string, body?: string): void;
  /** Dock / taskbar badge (0 clears it). */
  setBadge(count: number): void;
  /** Mirror the in-app menu model into the native application menu (macOS). */
  setMenu(menus: NativeMenu[]): void;
  /** Native menu clicks; returns an unsubscribe function. */
  onMenu(cb: (id: string) => void): () => void;
}

export function desktop(): RexDesktop | null {
  if (typeof window === "undefined") return null;
  const d = (window as Window & { rexDesktop?: RexDesktop }).rexDesktop;
  return d?.isDesktop ? d : null;
}

/** Desktop app on macOS: the native menu bar replaces REX's in-app menu row. */
export const isDesktopMac = () => desktop()?.platform === "darwin";
