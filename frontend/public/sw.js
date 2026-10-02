// Service worker: instalación PWA + notificaciones push (VAPID).
// El caché solo toca GETs del MISMO origen (nunca la API del backend, que vive en otro puerto).
// Solo recursos estáticos y páginas públicas; nunca sesión, HTML privado ni respuestas RSC.
const CACHE = "indicem-v7";
const INMUTABLE = /^\/_next\/static\//;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => /^(agentic-|indicem-)/.test(k) && k !== CACHE).map((k) => caches.delete(k))))
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
  const publica = event.request.mode === "navigate"
    && (url.pathname === "/" || url.pathname === "/como-funciona" || url.pathname.startsWith("/legal/"));
  const marca = /^\/(?:favicon\.(?:svg|ico)|marca\.svg|icon-[\w-]+\.png|apple-touch-icon\.png|manifest\.webmanifest|admin\/manifest\.json)$/.test(url.pathname);
  if (!publica && !marca) return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        // Solo respuestas buenas: guardar un 404 o un 500 haría que sin conexión se sirviera
        // el error en lugar de la última página que funcionó.
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(async () => (await caches.match(event.request)) || Response.error())
  );
});

// ---- Push: el timbre de Alpha ----------------------------------------

self.addEventListener("push", (event) => {
  let data = { title: "índicem", body: "Nueva alerta.", url: "/admin/alpha", tag: "agentic-alpha" };
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
  const url = event.notification.data?.url || "/admin/alpha";
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
