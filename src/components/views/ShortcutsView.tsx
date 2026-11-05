"use client";
import { useMemo, useState } from "react";
import { Keyboard, Search, X } from "lucide-react";
import { SHORTCUTS, kbd } from "@/components/workbench/shortcuts";
import { Page, PageHeader } from "@/components/ui/kit";
import { EmptyState } from "@/components/ui/empty";

/** "Help: Keyboard shortcuts" tab — searchable table of every workbench shortcut, grouped. */
export default function ShortcutsView() {
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    const t = q.toLowerCase().trim();
    return SHORTCUTS.filter((s) => s.keys || s.alt).filter(
      (s) => !t || s.label.toLowerCase().includes(t) || s.group.toLowerCase().includes(t) || kbd(s.keys).toLowerCase().includes(t) || (s.alt && kbd(s.alt).toLowerCase().includes(t)),
    );
  }, [q]);
  const groups = useMemo(() => {
    const m = new Map<string, typeof rows>();
    for (const r of rows) m.set(r.group, [...(m.get(r.group) ?? []), r]);
    return [...m.entries()];
  }, [rows]);

  return (
    <Page>
      <div className="mx-auto max-w-3xl">
        <PageHeader
          title="Keyboard shortcuts"
          description="Shortcuts with ⌘ also work while typing. The browser may take some keys (⌘W, ⌘N, ⌃Tab); use the alternative binding for those."
        />
        <div className="relative mb-4">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" aria-hidden />
          <input
            autoFocus
            type="search"
            className="input !pl-8 !pr-8"
            placeholder="Search by command, group or key"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && q && (e.stopPropagation(), setQ(""))}
            aria-label="Search shortcuts"
          />
          {q && (
            <button className="icon-btn absolute right-1 top-1/2 !h-5 !w-5 -translate-y-1/2" aria-label="Clear search" title="Clear search (Esc)" onClick={() => setQ("")}>
              <X size={12} />
            </button>
          )}
        </div>
        {rows.length ? (
          <div className="overflow-x-auto rounded-[6px] border border-line">
            <table className="tbl">
              <thead>
                <tr>
                  <th scope="col">Command</th>
                  <th scope="col" className="w-[45%]">
                    Keybinding
                  </th>
                </tr>
              </thead>
              {groups.map(([group, items]) => (
                <tbody key={group}>
                  <tr>
                    <th scope="colgroup" colSpan={2} className="section-title !h-7 bg-side !text-[11px]">
                      {group}
                    </th>
                  </tr>
                  {items.map((s) => (
                    <tr key={s.id}>
                      <td>{s.label}</td>
                      <td>
                        <span className="kbd">{kbd(s.keys)}</span>
                        {s.alt && (
                          <>
                            <span className="mx-1.5 text-[11px] text-faint">or</span>
                            <span className="kbd">{kbd(s.alt)}</span>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        ) : (
          <div className="card">
            <EmptyState icon={Keyboard} title="No shortcuts match" hint={`Nothing matches “${q}”. Try a command name or a key like ⌘P.`} secondary={{ label: "Clear search", onClick: () => setQ("") }} />
          </div>
        )}
      </div>
    </Page>
  );
}
