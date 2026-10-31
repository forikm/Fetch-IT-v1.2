"use client";
import { useEffect, useSyncExternalStore } from "react";
import { useAppStore } from "@/lib/store";
type Theme = "system" | "light" | "dark";
const key = "fetchit:appearance";
function subscribe(notify: () => void) {
  window.addEventListener("fetchit:appearance", notify); window.addEventListener("storage", notify);
  return () => { window.removeEventListener("fetchit:appearance", notify); window.removeEventListener("storage", notify); };
}
function read(): Theme { try { const theme = localStorage.getItem(key); return theme === "light" || theme === "dark" ? theme : "system"; } catch { return "system"; } }
export function useCustomerAppearance() {
  const theme = useSyncExternalStore(subscribe, read, () => "system" as Theme);
  return { theme, setTheme(value: Theme) { try { localStorage.setItem(key, value); } catch { /* Device preference still applies when storage is unavailable. */ } window.dispatchEvent(new Event("fetchit:appearance")); } };
}
export function CustomerAppearance() {
  const { theme } = useCustomerAppearance();
  const view = useAppStore(s => s.view);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && preference.matches);
      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.style.colorScheme = dark ? "dark" : "light";
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", getComputedStyle(document.body).backgroundColor);
    };
    apply(); preference.addEventListener("change", apply);
    return () => preference.removeEventListener("change", apply);
  }, [theme, view]);
  return null;
}
