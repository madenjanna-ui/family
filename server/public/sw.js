const CACHE = "family-shell-v21-3";
const SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css?v=21.4",
  "./js/config.js?v=3",
  "./js/api.js?v=21.4",
  "./js/auth.js?v=11",
  "./js/app.js?v=21.4",
  "./js/media.js?v=3",
  "./assets/icon-180.png",
  "./assets/icon-512.png",
  "./apple-touch-icon.png"
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const url of SHELL) {
      try { await cache.add(url); }
      catch (e) { console.warn("Family SW precache skipped:", url, e); }
    }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok) {
        try {
          const copy = res.clone();
          const cache = await caches.open(CACHE);
          await cache.put(req, copy);
        } catch (e) {
          console.warn("Family SW cache:", e);
        }
      }
      return res;
    } catch (e) {
      return (await caches.match(req)) || (await caches.match("./index.html"));
    }
  })());
});

self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch { data = {title:"Family", body:event.data?.text() || "Новое сообщение"}; }
  event.waitUntil(self.registration.showNotification(data.title || "Family😍", {
    body: data.body || "Новое сообщение",
    icon: "./assets/icon-180.png",
    badge: "./assets/icon-180.png",
    tag: data.tag || "family-message",
    renotify: true,
    data: { url: data.url || "./", chatId: data.chatId || null, scope: data.scope || null }
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "./", self.location.href).href;
  event.waitUntil(clients.matchAll({type:"window", includeUncontrolled:true}).then(list => {
    for (const client of list) {
      if ("focus" in client) {
        client.focus();
        if ("navigate" in client && client.url !== target) return client.navigate(target);
        return;
      }
    }
    return clients.openWindow(target);
  }));
});
