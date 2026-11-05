"use client";
import { useEffect } from "react";
import { getThemePref, onThemeChange, type ThemePref } from "@/components/ui/theme";
import { useSetting, useSettingsStore } from "@/store/settings";
import { useWorkbench } from "@/store/workbench";
import { applyAppearance } from "@/components/ui/colorTheme";

/** Effective CSS zoom for the workbench: zoomLevel (10%/step) × uiFontSize relative to 13px. */
export function zoomFactor(level: number, uiFontSize: number): number {
  return Math.round((1 + level * 0.1) * (uiFontSize / 13) * 1000) / 1000;
}

/** Writes the theme pref into the settings store without re-applying it (it's already applied). */
function syncTheme(pref: ThemePref) {
  useSettingsStore.setState((s) => {
    const values = { ...s.values };
    if (pref === "dark") delete values["appearance.theme"];
    else values["appearance.theme"] = pref;
    return values["appearance.theme"] === s.values["appearance.theme"] ? s : { values };
  });
}

/**
 * Applies appearance-level user settings to <html>: zoom, color theme + accent color, density,
 * reduced motion; keeps appearance.theme in sync with ui/theme.ts. Renders nothing.
 */
export default function SettingsEffects() {
  const zoomLevel = useSetting<number>("workbench.zoomLevel");
  const uiFontSize = useSetting<number>("appearance.uiFontSize");
  const accent = useSetting<string>("appearance.accentColor");
  const density = useSetting<string>("appearance.density");
  const reduceMotion = useSetting<boolean>("workbench.reduceMotion");
  const colorTheme = useSetting<string>("appearance.colorTheme");
  const themePref = useSetting<string>("appearance.theme") as ThemePref;
  const themes = useWorkbench((s) => s.themes);
  const themesLoaded = useWorkbench((s) => s.themesLoaded);

  useEffect(() => {
    syncTheme(getThemePref());
    return onThemeChange((_, pref) => syncTheme(pref));
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const z = zoomFactor(zoomLevel, uiFontSize);
    if (z === 1) root.style.removeProperty("zoom");
    else root.style.zoom = String(z);
    root.style.setProperty("--rex-zoom", String(z));
    // Monaco/xterm measure on resize; nudge them after the zoom change.
    window.dispatchEvent(new Event("resize"));
  }, [zoomLevel, uiFontSize]);

  // Contributed color theme + accent override, as inline CSS vars on <html> (cached for the boot script).
  useEffect(() => {
    // Until the extension themes have loaded keep whatever the boot script applied (no flash).
    if (colorTheme && !themesLoaded) return;
    applyAppearance({ colorTheme, themePref, accent, themes });
  }, [colorTheme, themePref, accent, themes, themesLoaded]);

  useEffect(() => {
    document.documentElement.dataset.density = density;
  }, [density]);

  useEffect(() => {
    document.documentElement.classList.toggle("reduce-motion", reduceMotion);
  }, [reduceMotion]);

  return null;
}
