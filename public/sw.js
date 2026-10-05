// Cache public UI only. Private booking data is saved per account by the app.
const CACHE_VERSION = "fetchit-customer-v8";
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
self.addEventListener("message", event => { if (event.data === "SKIP_WAITING") self.skipWaiting(); });
self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async clients => {
    const client = clients.find(item => new URL(item.url).origin === self.location.origin);
    if (client) return client.focus();
    return self.clients.openWindow("/");
  }));
});
