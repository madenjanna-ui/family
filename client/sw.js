const CACHE = "family-shell-v6-3-push";
const SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css?v=23",
  "./js/config.js?v=3",
  "./js/api.js?v=23",
  "./js/auth.js?v=10",
  "./js/app.js?v=23",
  "./assets/icon-180.png",
  "./assets/icon-512.png",
  "./js/media.js?v=2"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(fetch(req).then(res => {
    if (res.ok) caches.open(CACHE).then(c => c.put(req, res.clone()));
    return res;
  }).catch(() => caches.match(req).then(r => r || caches.match("./index.html"))));
});

self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {title:"Family", body:event.data?.text() || "Новое сообщение"}; }
  const title = data.title || "Family😍";
  const options = {
    body: data.body || "Новое сообщение",
    icon: "./assets/icon-180.png",
    badge: "./assets/icon-180.png",
    tag: data.tag || "family-message",
    renotify: true,
    requireInteraction: Boolean(data.requireInteraction),
    data: { url: data.url || "./", tag: data.tag || "family-message" }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "./", self.location.href).href;
  event.waitUntil(clients.matchAll({type:"window", includeUncontrolled:true}).then(list => {
    for (const client of list) {
      if ("focus" in client) { client.focus(); return; }
    }
    return clients.openWindow(target);
  }));
});
