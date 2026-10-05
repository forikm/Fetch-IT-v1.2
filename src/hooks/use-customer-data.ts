"use client";

import { useSyncExternalStore } from "react";

const memory = new Map<string, string>();
const eventName = "fetchit-customer-data";
if (typeof window !== "undefined") window.addEventListener(eventName, (event) => {
  const id = (event as CustomEvent<{ clearUserId?: string }>).detail?.clearUserId;
  if (id) for (const key of memory.keys()) if (key.startsWith(`fetchit:${id}:`)) memory.delete(key);
});

/** Account-scoped storage. Persistent drafts and saved places survive app restarts. */
export function useCustomerData<T>(userId: string, name: string, initial: T, persistent = false) {
  const key = `fetchit:${userId}:${name}`;
  const read = () => {
    try {
      return memory.get(key) ?? (persistent ? localStorage : sessionStorage).getItem(key) ?? null;
    } catch {
      return memory.get(key) ?? null;
    }
  };
  const raw = useSyncExternalStore(
    (notify) => {
      window.addEventListener(eventName, notify);
      window.addEventListener("storage", notify);
      return () => {
        window.removeEventListener(eventName, notify);
        window.removeEventListener("storage", notify);
      };
    },
    read,
    () => null,
  );
  let value = initial;
  try { if (raw) value = JSON.parse(raw) as T; } catch { /* Ignore damaged local data. */ }
  function setValue(next: T | ((previous: T) => T)) {
    let previous = initial;
    try { const stored = read(); if (stored) previous = JSON.parse(stored) as T; } catch { /* Reset damaged data. */ }
    const serialized = JSON.stringify(typeof next === "function" ? (next as (v: T) => T)(previous) : next);
    try { (persistent ? localStorage : sessionStorage).setItem(key, serialized); memory.delete(key); } catch { memory.set(key, serialized); }
    window.dispatchEvent(new Event(eventName));
  }
  return [value, setValue] as const;
}
