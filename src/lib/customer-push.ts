"use client";
import { customerResponse } from "@/lib/customer-request";
import { useAppStore } from "@/lib/store";

async function worker() {
  const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([navigator.serviceWorker.ready, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Notifications are still getting ready. Please try again.")), 15000); })]); }
  finally { clearTimeout(timer); }
  return registration;
}

let accountVersion = 0;
export async function setPushAccount(customerId: string | null) {
  const version = ++accountVersion;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration();
  if (version !== accountVersion) return;
  (registration?.active ?? navigator.serviceWorker.controller)?.postMessage({ type: "PUSH_ACCOUNT", customerId });
}

function applicationKey(value: string): Uint8Array<ArrayBuffer> {
  const raw = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, character => character.charCodeAt(0));
}

const pending = new Map<string, Promise<void>>();
export function ensureCustomerPush(customerId: string): Promise<void> {
  const existing = pending.get(customerId);
  if (existing) return existing;
  const task = (async () => {
    const registration = await worker();
    if (useAppStore.getState().user?.id !== customerId) return;
    await setPushAccount(customerId);
    const config = await customerResponse<{ publicKey: string; enabled: boolean }>(await fetch("/api/push/subscription", { cache: "no-store" }), "Couldn’t set up notifications. Please retry.");
    const key = applicationKey(config.publicKey);
    if (useAppStore.getState().user?.id !== customerId) return;
    let subscription = await registration.pushManager.getSubscription();
    if (subscription?.options.applicationServerKey && !equalKey(subscription.options.applicationServerKey, key)) {
      await subscription.unsubscribe(); subscription = null;
    }
    if (subscription && config.enabled) return;
    subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    if (useAppStore.getState().user?.id !== customerId) return;
    await customerResponse(await fetch("/api/push/subscription", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(subscription.toJSON()) }), "Couldn’t save notifications for this device. Please retry.");
  })().finally(() => pending.delete(customerId));
  pending.set(customerId, task);
  return task;
}
function equalKey(saved: ArrayBuffer, expected: Uint8Array) {
  const bytes = new Uint8Array(saved);
  return bytes.length === expected.length && bytes.every((value, index) => value === expected[index]);
}

export async function enableCustomerPush(customerId: string) {
  if (!window.isSecureContext || !("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    throw new Error("This browser cannot receive background alerts. On iPhone or iPad, add Fetch-It to your Home Screen, then enable alerts from there.");
  }
  // Request directly from the click, before any network await (required on Safari).
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Allow notifications in your browser settings to receive background alerts.");
  await ensureCustomerPush(customerId);
}

export async function disableCustomerPush() {
  await customerResponse(await fetch("/api/push/subscription", { method: "DELETE" }), "Connect to the internet to turn off alerts on this device.");
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  await subscription?.unsubscribe().catch(() => false);
}
