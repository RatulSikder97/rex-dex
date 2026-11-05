"use client";
import type { ProviderId } from "@/lib/types";
import { useAgents } from "@/store/workbench";

/**
 * Terminal-agent selector. "" = Auto: the agent this department is set to use
 * (Settings → Agents), resolved again on the server at run time.
 */
export default function AgentPicker({
  value,
  onChange,
  department,
  className = "input input-sm w-auto",
  title = "Agent that runs this department",
}: {
  value: ProviderId | "";
  onChange: (v: ProviderId | "") => void;
  department: string;
  className?: string;
  title?: string;
}) {
  const { agents, label, forDepartment } = useAgents();
  return (
    <select className={className} value={value} onChange={(e) => onChange(e.target.value)} title={title} aria-label={title}>
      <option value="">Auto · {label(forDepartment(department))}</option>
      {agents.map((a) => (
        <option key={a.id} value={a.id} disabled={!a.available}>
          {a.label}
          {a.available ? "" : " (not installed)"}
        </option>
      ))}
    </select>
  );
}
