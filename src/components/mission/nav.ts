"use client";
import { useWorkbench, type MissionTab, type TabSpec } from "@/store/workbench";

/** Pseudo page ids that aren't editor tabs. */
export const EXTENSIONS_PAGE = "@extensions";

/** Shows a page (an editor tab id, or a pseudo page like "@extensions") over the Mission conversation. */
export function openMissionPage(id: string | null) {
  useWorkbench.getState().setMission({ missionPage: id });
}

/** Opens an editor tab as a Mission page. */
export function openPage(spec: TabSpec, title: string) {
  const s = useWorkbench.getState();
  s.openTab(spec, title);
  openMissionPage(useWorkbench.getState().activeTabId);
}

/** Starts a fresh conversation with a department and focuses the composer. */
export function startConversation(department: string) {
  const s = useWorkbench.getState();
  s.setMission({ missionPage: null });
  s.openConversation({ department, threadId: null });
  requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[data-region="agent"] textarea')?.focus({ preventScroll: true }));
}

/** Opens the Workspace panel on a tab. */
export function showWorkspace(tab: MissionTab) {
  useWorkbench.getState().setMission({ missionTab: tab, missionWorkspaceOpen: true });
  window.dispatchEvent(new CustomEvent("rex:mission-workspace", { detail: tab }));
}

/** Switches to Code mode, optionally opening a tab there. */
export function openInCodeMode(spec?: TabSpec, title?: string) {
  const s = useWorkbench.getState();
  if (spec && title) s.openTab(spec, title);
  s.setMission({ missionPage: null });
  s.setLayoutMode("code");
}

/** Brings the conversation to the front (closes any page, and the Workspace drawer on narrow screens). */
export function focusConversation() {
  useWorkbench.getState().setMission({ missionPage: null });
  window.dispatchEvent(new CustomEvent("rex:mission-focus-chat"));
}
