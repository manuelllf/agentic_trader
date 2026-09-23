// Service worker: instalación PWA + notificaciones push (VAPID).
// El caché solo toca GETs del MISMO origen (nunca la API del backend, que vive en otro puerto).
// v4: lo inmutable (`/_next/static`, con hash en el nombre, e iconos) sale de caché sin esperar
// a la red; la página sigue yendo a red primero para no servir un despliegue viejo.
const CACHE = "agentic-v4";
const INMUTABLE = /^\/(_next\/static\/|icon-|apple-touch-icon|favicon)/;

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
  if (INMUTABLE.test(url.pathname)) {
    event.respondWith(
      caches.match(event.request).then((hit) => hit || fetch(event.request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy)).catch(() => {});
        }
        return res;
      }))
    );
    return;
  }
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
