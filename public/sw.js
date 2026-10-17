// Cache public UI only. Private booking data is saved per account by the app.
const CACHE_VERSION = "fetchit-customer-v9";
const APP_SHELL = ["/", "/help", "/manifest.webmanifest", "/pwa-icon-any-v2-192.png", "/pwa-icon-any-v2-512.png", "/pwa-icon-maskable-v2-192.png", "/pwa-icon-maskable-v2-512.png", "/fetch-logo-final.png", "/fetch-loading.gif"];

function staticAssets(text) {
  return [...new Set(text.match(/\/_next\/static\/[^\s"'<>\\)]+/g) || [])];
}
async function cacheAsset(cache, path) {
  const response = await fetch(path, { cache: "reload" });
  if (!response.ok || response.type !== "basic") throw new Error("Asset unavailable");
  await cache.put(path, response.clone());
  return response;
}
self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    // Warm JS/CSS/fonts during installation: first-load requests can predate SW control.
    const shell = await Promise.allSettled(APP_SHELL.map(path => cacheAsset(cache, path)));
    // Keep the previous worker if the replacement cannot reopen the app.
    if (shell[0].status !== "fulfilled") throw new Error("App shell unavailable");
    const rootAssets = staticAssets(await shell[0].value.clone().text());
    const pages = await Promise.all(shell.slice(0, 2).filter(item => item.status === "fulfilled").map(item => item.value.text()));
    const assets = [...new Set(pages.flatMap(staticAssets))];
    const responses = await Promise.allSettled(assets.map(path => cacheAsset(cache, path)));
    if (responses.some((item, index) => item.status === "rejected" && rootAssets.includes(assets[index]))) throw new Error("App assets unavailable");
    const styles = await Promise.all(responses.filter((item, index) => item.status === "fulfilled" && assets[index].split("?")[0].endsWith(".css")).map(item => item.value.text()));
    await Promise.allSettled([...new Set(styles.flatMap(staticAssets))].map(path => cacheAsset(cache, path)));
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith("fetchit-customer-") && key !== CACHE_VERSION).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  // Never intercept private APIs, writes, socket traffic, or third-party maps/auth.
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/socket.io/")) return;
  if (request.mode === "navigate") {
    if (url.pathname !== "/" && url.pathname !== "/help") return;
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_VERSION);
      const saved = await cache.match(url.pathname);
      const controller = new AbortController();
      const timer = saved ? setTimeout(() => controller.abort(), 5000) : null;
      try {
        const response = await fetch(request, { signal: controller.signal });
        if (response.ok && !url.search) await cache.put(url.pathname, response.clone());
        return !response.ok && saved ? saved : response;
      } catch {
        return saved || new Response("Connect to the internet to open Fetch-It for the first time.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      } finally { if (timer) clearTimeout(timer); }
    })());
    return;
  }
  if (!url.pathname.startsWith("/_next/static/") && !APP_SHELL.slice(2).includes(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    const saved = await cache.match(request);
    const network = fetch(request).then(async response => {
      if (response.ok && response.type === "basic") await cache.put(request, response.clone());
      return response;
    });
    if (saved) { event.waitUntil(network.catch(() => {})); return saved; }
    return network;
  })());
});
// Persist only the active account identifier, never notification text or credentials.
// A worker can start while every page is closed, so in-memory state is insufficient.
function pushAccount(write, customerId) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("fetchit-notification-state", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("settings");
    request.onerror = () => reject(new Error("Notification state unavailable"));
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("settings", write ? "readwrite" : "readonly");
      const store = tx.objectStore("settings");
      const operation = write ? store.put(customerId, "customer") : store.get("customer");
      tx.oncomplete = () => { db.close(); resolve(write ? customerId : operation.result ?? null); };
      tx.onabort = tx.onerror = () => { db.close(); reject(new Error("Notification state unavailable")); };
    };
  });
}
let accountWrite = Promise.resolve();
self.addEventListener("message", event => {
  if (event.data === "SKIP_WAITING") { self.skipWaiting(); return; }
  if (event.data?.type !== "PUSH_ACCOUNT" || (event.data.customerId !== null && (typeof event.data.customerId !== "string" || event.data.customerId.length > 100))) return;
  accountWrite = accountWrite.catch(() => {}).then(() => pushAccount(true, event.data.customerId));
  event.waitUntil(accountWrite.then(async () => {
    if (event.data.customerId === null) for (const notification of await self.registration.getNotifications()) notification.close();
  }));
});
function notificationUrl(value) {
  try {
    const url = new URL(value, self.location.origin);
    return url.origin === self.location.origin && ["/", "/help"].includes(url.pathname) ? url : null;
  } catch { return null; }
}
self.addEventListener("push", event => {
  event.waitUntil((async () => {
    let data;
    try { data = event.data?.json(); } catch { return; }
    const labels = { DELIVERY: "Deliveries", RIDE: "Rides", SUPPORT: "Support" };
    if (!data || !labels[data.category] || typeof data.id !== "string" || typeof data.title !== "string" || !notificationUrl(data.url)) return;
    await accountWrite;
    // Account switches and offline sign-out must not expose another user's alerts.
    if (await pushAccount(false) !== data.customerId) return;
    await self.registration.showNotification(`${labels[data.category]} · ${data.title}`, {
      body: typeof data.body === "string" ? data.body : "Open Fetch-It to view this update.",
      icon: "/pwa-icon-any-v2-192.png", badge: "/pwa-icon-any-v2-192.png", tag: data.id,
      data: { url: data.url, notificationId: data.id, customerId: data.customerId },
    });
    for (const client of await self.clients.matchAll({ type: "window", includeUncontrolled: true })) {
      if (new URL(client.url).origin === self.location.origin) client.postMessage({ type: "FETCHIT_PUSH", customerId: data.customerId });
    }
  })());
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil((async () => {
    await accountWrite;
    const data = event.notification.data;
    const owner = await pushAccount(false);
    const url = owner && owner === data?.customerId ? notificationUrl(data.url) : null;
    if (url && typeof data.notificationId === "string") url.searchParams.set("notice", data.notificationId);
    const target = url?.href ?? self.location.origin + "/";
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const client = clients.find(item => new URL(item.url).origin === self.location.origin);
    if (client) {
      const navigated = await client.navigate(target);
      return (navigated ?? client).focus();
    }
    return self.clients.openWindow(target);
  })());
});
