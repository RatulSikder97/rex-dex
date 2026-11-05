import { icons, Bot } from "lucide-react";

/** Renders a lucide icon by name (any of ~2000), or the string itself if it's an emoji. */
export function DeptIcon({ name, size = 14, color }: { name: string; size?: number; color?: string }) {
  const Icon = icons[name as keyof typeof icons];
  if (Icon) return <Icon size={size} color={color} />;
  if (name && !/^[A-Za-z0-9]+$/.test(name)) return <span style={{ fontSize: size, lineHeight: 1 }}>{name}</span>;
  return <Bot size={size} color={color} />;
}
