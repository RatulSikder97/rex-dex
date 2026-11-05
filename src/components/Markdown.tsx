"use client";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check } from "lucide-react";

/** GFM task-list checkbox: a readable, theme-aware box (native disabled checkboxes render as faint gray squares). */
function TaskCheck({ checked }: { checked: boolean }) {
  return (
    <span
      role="img"
      aria-label={checked ? "Done" : "Not done"}
      className={`mr-1 inline-grid h-[14px] w-[14px] shrink-0 translate-y-[2px] place-items-center rounded-[3px] border align-baseline ${
        checked ? "border-transparent bg-accent text-[color:var(--accent-fg)]" : "border-[color:color-mix(in_srgb,var(--fg-muted)_70%,transparent)] bg-input"
      }`}
    >
      {checked && <Check size={10} strokeWidth={3} aria-hidden />}
    </span>
  );
}

const COMPONENTS: Components = {
  a: ({ node: _node, ...p }) => <a {...p} target="_blank" rel="noreferrer" />,
  input: ({ node: _node, type, checked, ...p }) => (type === "checkbox" ? <TaskCheck checked={!!checked} /> : <input type={type} checked={checked} {...p} />),
  li: ({ node: _node, className, ...p }) => (
    <li className={className?.includes("task-list-item") ? `${className} -ml-[1.2em]! list-none!` : className} {...p} />
  ),
  ul: ({ node: _node, className, ...p }) => <ul className={className?.includes("contains-task-list") ? `${className} list-none!` : className} {...p} />,
};

export default function Markdown({ text, streaming }: { text: string; streaming?: boolean }) {
  return (
    <div className={`md ${streaming ? "caret" : ""}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
