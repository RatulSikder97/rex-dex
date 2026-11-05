"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { SETTINGS_BY_KEY, validateSetting, type SettingValue } from "@/lib/userSettings";
import { setTheme, type ThemePref } from "@/components/ui/theme";

interface SettingsState {
  /** Only user-overridden values. Missing keys resolve to the schema default. */
  values: Record<string, SettingValue>;
  get: <T extends SettingValue = SettingValue>(key: string) => T;
  /** Validates against the schema; returns false (and changes nothing) for unknown keys / invalid values. */
  set: (key: string, value: unknown) => boolean;
  reset: (key: string) => void;
  resetAll: () => void;
  /** Replaces all overrides with a validated copy of `obj`. Returns keys that were rejected. */
  importJson: (obj: unknown) => { applied: string[]; rejected: string[] };
}

function sideEffects(key: string, value: SettingValue | undefined) {
  // The theme preference lives in ui/theme.ts (pre-paint boot script reads it), keep both in sync.
  if (key === "appearance.theme" && typeof window !== "undefined") setTheme(((value as ThemePref | undefined) ?? (SETTINGS_BY_KEY[key].default as ThemePref)) as ThemePref);
}

function defaultOf(key: string): SettingValue | undefined {
  return SETTINGS_BY_KEY[key]?.default;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      values: {},
      get: <T extends SettingValue = SettingValue>(key: string) => (get().values[key] ?? defaultOf(key)) as T,
      set: (key, value) => {
        const v = validateSetting(key, value);
        if (v === undefined) return false;
        set((s) => {
          const values = { ...s.values };
          if (v === defaultOf(key)) delete values[key];
          else values[key] = v;
          return { values };
        });
        sideEffects(key, v);
        return true;
      },
      reset: (key) => {
        set((s) => {
          if (!(key in s.values)) return s;
          const values = { ...s.values };
          delete values[key];
          return { values };
        });
        sideEffects(key, undefined);
      },
      resetAll: () => {
        set({ values: {} });
        sideEffects("appearance.theme", undefined);
      },
      importJson: (obj) => {
        const applied: string[] = [];
        const rejected: string[] = [];
        const values: Record<string, SettingValue> = {};
        if (obj && typeof obj === "object" && !Array.isArray(obj)) {
          for (const [k, raw] of Object.entries(obj as Record<string, unknown>)) {
            const v = validateSetting(k, raw);
            if (v === undefined) rejected.push(k);
            else {
              applied.push(k);
              if (v !== defaultOf(k)) values[k] = v;
            }
          }
        }
        set({ values });
        sideEffects("appearance.theme", values["appearance.theme"]);
        return { applied, rejected };
      },
    }),
    {
      name: "rex-settings",
      partialize: (s) => ({ values: s.values }),
      // Drop persisted keys that no longer exist / no longer validate.
      merge: (persisted, current) => {
        const raw = (persisted as { values?: Record<string, unknown> } | undefined)?.values ?? {};
        const values: Record<string, SettingValue> = {};
        for (const [k, v] of Object.entries(raw)) {
          const ok = validateSetting(k, v);
          if (ok !== undefined) values[k] = ok;
        }
        return { ...current, values };
      },
    },
  ),
);

/** Reactive setting value (override or schema default). */
export function useSetting<T extends SettingValue = SettingValue>(key: string): T {
  return useSettingsStore((s) => (s.values[key] ?? defaultOf(key)) as T);
}

/** Non-reactive read (event handlers, imperative code). */
export function getSetting<T extends SettingValue = SettingValue>(key: string): T {
  return (useSettingsStore.getState().values[key] ?? defaultOf(key)) as T;
}

/** True when the user overrode `key`. */
export function useIsModified(key: string): boolean {
  return useSettingsStore((s) => key in s.values);
}
