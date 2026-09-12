// Service worker: instalación PWA + notificaciones push (VAPID).
// El caché solo toca GETs del MISMO origen (nunca la API del backend, que vive en otro puerto).
// v3: iconos de la PWA regenerados con el logo actual (línea de señal + punto de entrada).
const CACHE = "agentic-v3";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
);

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(event.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});

// ---- Push: el timbre de Alpha ----------------------------------------

self.addEventListener("push", (event) => {
  let data = { title: "Agentic Trader", body: "Nueva alerta.", url: "/alpha", tag: "agentic-alpha" };
  try {
    data = { ...data, ...event.data.json() };
  } catch {
    /* payload no-JSON → defaults */
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: data.tag,                 // cada sala la suya -- colapsa repetidas, no se pisan entre salas
      data: { url: data.url },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/alpha";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((tabs) => {
      for (const tab of tabs) {
        if (new URL(tab.url).origin === self.location.origin) {
          tab.navigate(url);
          return tab.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
