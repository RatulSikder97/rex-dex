"use client";
import { Blocks, Bot, Clapperboard, Files, GitBranch, Globe, History, Image, LayoutDashboard, Library, Search, Settings, SquareKanban, WandSparkles, type LucideIcon } from "lucide-react";
import { useWorkbench, type Activity } from "@/store/workbench";
import { activate } from "./actions";
import { withShortcut } from "./shortcuts";

export const ACTIVITIES: { id: Activity; label: string; icon: LucideIcon; shortcut?: string }[] = [
  { id: "command", label: "Command center", icon: LayoutDashboard },
  { id: "plan", label: "Plan & board", icon: SquareKanban },
  { id: "code", label: "Explorer", icon: Files, shortcut: "explorer" },
  { id: "search", label: "Search", icon: Search, shortcut: "search" },
  { id: "scm", label: "Source control", icon: GitBranch, shortcut: "scm" },
  { id: "library", label: "Deliverables", icon: Library },
  { id: "seo", label: "SEO & AEO", icon: Globe },
  { id: "create", label: "Create studio (AI video & audio)", icon: WandSparkles },
  { id: "graphics", label: "Graphics studio", icon: Image },
  { id: "video", label: "Video editor", icon: Clapperboard },
  { id: "runs", label: "Agent runs", icon: History, shortcut: "runs" },
  { id: "extensions", label: "Extensions", icon: Blocks, shortcut: "extensions" },
];

export const activityLabel = (a: Activity) => (a === "settings" ? "Settings" : (ACTIVITIES.find((x) => x.id === a)?.label ?? a));

export default function ActivityBar({ side = "left" }: { side?: "left" | "right" }) {
  const activity = useWorkbench((s) => s.activity);
  const sidebarOpen = useWorkbench((s) => s.sidebarOpen);
  const agentOpen = useWorkbench((s) => s.agentOpen);
  const toggleAgent = useWorkbench((s) => s.toggleAgent);
  const running = useWorkbench((s) => s.runningRuns);

  const item = (id: Activity, label: string, Icon: LucideIcon, shortcutId?: string, badge?: number) => {
    const active = activity === id && sidebarOpen;
    const title = withShortcut(label, shortcutId ?? "");
    return (
      <button
        key={id}
        title={title}
        aria-label={badge ? `${label}, ${badge} running` : label}
        aria-pressed={active}
        onClick={() => activate(id)}
        className={`activity-item relative flex h-12 w-12 shrink-0 items-center justify-center ${active ? "text-fg" : "text-faint hover:text-fg"}`}
      >
        {active && <span className={`absolute inset-y-0 w-[2px] bg-accent ${side === "right" ? "right-0" : "left-0"}`} aria-hidden />}
        <Icon size={22} strokeWidth={1.5} aria-hidden />
        {!!badge && <span className="badge absolute bottom-2 right-2" aria-hidden>{badge}</span>}
      </button>
    );
  };

  return (
    <nav aria-label="Activity bar" className={`flex w-12 shrink-0 flex-col items-center overflow-y-auto overflow-x-hidden ${side === "right" ? "border-l" : "border-r"} border-line bg-activity [scrollbar-width:none]`}>
      {ACTIVITIES.map((a) => item(a.id, a.label, a.icon, a.shortcut, a.id === "runs" ? running : undefined))}
      <div className="min-h-2 flex-1" />
      <button
        title={withShortcut("Toggle agent panel", "agent")}
        aria-label={running ? `Toggle agent panel, ${running} running` : "Toggle agent panel"}
        aria-pressed={agentOpen}
        onClick={() => toggleAgent()}
        className={`activity-item relative flex h-12 w-12 shrink-0 items-center justify-center ${agentOpen ? "text-fg" : "text-faint hover:text-fg"}`}
      >
        <Bot size={22} strokeWidth={1.5} aria-hidden />
        {!!running && <span className="badge absolute bottom-2 right-2" aria-hidden>{running}</span>}
      </button>
      {item("settings", "Settings", Settings, "settings")}
    </nav>
  );
}
