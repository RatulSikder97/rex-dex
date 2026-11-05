"use client";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { SHORTCUTS, kbd } from "@/components/workbench/shortcuts";

/** "Help: Keyboard Shortcuts" tab — searchable table of every workbench shortcut. */
export default function ShortcutsView() {
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    const t = q.toLowerCase().trim();
    return SHORTCUTS.filter((s) => s.keys || s.alt).filter(
      (s) => !t || s.label.toLowerCase().includes(t) || s.group.toLowerCase().includes(t) || kbd(s.keys).toLowerCase().includes(t) || (s.alt && kbd(s.alt).toLowerCase().includes(t)),
    );
  }, [q]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <header>
          <h1 className="text-lg font-semibold">Keyboard Shortcuts</h1>
          <p className="text-[12.5px] text-muted">
            Shortcuts with ⌘ also work while typing. Some browser-reserved keys (⌘W, ⌘N, ⌃Tab) may be taken by the browser; use the alternative binding.
          </p>
        </header>
        <label className="relative block">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <input autoFocus className="input !pl-8" placeholder="Search shortcuts by name, group, or key" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search shortcuts" />
        </label>
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted">
              <th className="py-2 pr-4 font-semibold">Command</th>
              <th className="py-2 pr-4 font-semibold">Keybinding</th>
              <th className="py-2 font-semibold">Group</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="border-b border-line/60 hover:bg-hover/50">
                <td className="py-1.5 pr-4">{s.label}</td>
                <td className="py-1.5 pr-4">
                  <span className="kbd">{kbd(s.keys)}</span>
                  {s.alt && (
                    <>
                      <span className="mx-1.5 text-faint">or</span>
                      <span className="kbd">{kbd(s.alt)}</span>
                    </>
                  )}
                </td>
                <td className="py-1.5 text-muted">{s.group}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={3} className="py-6 text-center text-muted">
                  No shortcuts match “{q}”.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
