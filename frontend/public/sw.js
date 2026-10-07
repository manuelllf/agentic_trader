// Service worker: instalación PWA + notificaciones push (VAPID).
// El caché solo toca GETs del MISMO origen (nunca la API del backend, que vive en otro puerto).
// Solo recursos estáticos y páginas públicas; nunca sesión, HTML privado ni respuestas RSC.
const CACHE = "vennett-v16-identidad";
const INMUTABLE = /^\/_next\/static\//;
const LOCALE_KEY = new URL("/__vennett_locale__", self.location.origin).href;
const clientLocales = new Map();
const supportedLocale = (value) => value === "es" || value === "en" ? value : null;
const publicKey = (request, locale) => {
  const key = new URL(request.url);
  key.searchParams.set("__vennett_locale", locale);
  return key.href;
};

self.addEventListener("message", (event) => {
  const locale = supportedLocale(event.data?.locale);
  if (event.data?.type !== "VENNETT_LOCALE" || !locale || !event.source?.id) return;
  clientLocales.set(event.source.id, locale);
  event.waitUntil(caches.open(CACHE).then((cache) => cache.put(LOCALE_KEY, new Response(locale))));
});

async function savedLocale(clientId) {
  if (clientLocales.has(clientId)) return clientLocales.get(clientId);
  const stored = await caches.match(LOCALE_KEY);
  return supportedLocale(stored && await stored.text()) || "es";
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => /^(agentic-|indicem-|vennett-)/.test(k) && k !== CACHE).map((k) => caches.delete(k))))
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
          const locale = supportedLocale(res.headers.get("Content-Language"));
          if (!publica || locale) {
            if (publica) clientLocales.set(event.resultingClientId || event.clientId, locale);
            caches.open(CACHE).then((c) => c.put(publica ? publicKey(event.request, locale) : event.request, copy)).catch(() => {});
          }
        }
        return res;
      })
      .catch(async () => (await caches.match(publica
        ? publicKey(event.request, await savedLocale(event.clientId)) : event.request)) || Response.error())
  );
});

// ---- Push: el timbre de Alpha ----------------------------------------

self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    const locale = await savedLocale("");
    let data = { title: "Vennett", body: locale === "en" ? "New alert." : "Nueva alerta.", url: "/admin/alpha", tag: "agentic-alpha" };
    try { data = { ...data, ...event.data.json() }; } catch { /* Keep the localized fallback. */ }
    await self.registration.showNotification(data.title, {
      body: data.body, icon: "/notif-192.png?v=vennett-8", badge: "/badge-96.png?v=vennett-8",
      tag: data.tag, data: { url: data.url },
    });
  })());
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
