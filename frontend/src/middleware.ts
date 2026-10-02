import { NextResponse, type NextRequest } from "next/server";

// CSP con nonce (plan §14/§15, tarea 8.1). Por ahora en modo "solo informe": el navegador no
// bloquea nada, solo lo reportaría si hubiera un `report-uri`/`report-to` (no hay todavía, así que
// las violaciones solo se ven en la consola del navegador). Para pasar a exigir de verdad, cuando
// unos días en producción no muestren avisos: cambia el nombre de las dos cabeceras de abajo, de
// "Content-Security-Policy-Report-Only" a "Content-Security-Policy" (en el `Headers` de la
// petición y en la respuesta), sin tocar nada más.
//
// OJO antes de exigir: comprobado con `npm run build` + `npm run start` que las rutas
// PRE-renderizadas en build (la portada, `/admin`…) no llevan nonce en el script inline de
// hidratación de Next (`__next_f`), porque en build no hay petición y por tanto no hay nonce. Con
// 'strict-dynamic' eso rompería esas páginas si se exige ya. O se revisa que no salten avisos en
// esas rutas concretas, o se las pasa a render dinámico (`export const dynamic = "force-dynamic"`)
// antes de exigir.
//
// `next.config.ts` ya manda un CSP mínimo y SIEMPRE en vigor (`frame-ancestors 'none'`, lo que
// corta clickjacking) más HSTS y demás cabeceras de endurecimiento: esta de aquí es la completa,
// todavía sin exigir, y vive en paralelo sin pisarla.
//
// El nonce por petición es el patrón oficial de Next (app router): se manda tanto en la cabecera
// de la petición (de ahí lo lee `getScriptNonceFromHeader` para los scripts inline que genera el
// propio Next — RSC payload, hidratación) como en la de la respuesta (de ahí lo lee el navegador
// para permitir esos mismos scripts). Ver docs de Next 15 "Content Security Policy".
function generarNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64");
}

/** wss:// a partir de la URL https de Supabase (Realtime va por WebSocket). */
function comoWebSocket(httpsUrl: string): string | null {
  if (!httpsUrl.startsWith("https://")) return null;
  return `wss://${httpsUrl.slice("https://".length)}`;
}

export function middleware(request: NextRequest) {
  const nonce = generarNonce();

  // Orígenes propios de este despliegue (no se puede fijar un solo dominio: local, PRE y PROD
  // usan API y Supabase distintos, y la CSP se calcula en tiempo de petición, no de build).
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const supabaseWs = supabaseUrl ? comoWebSocket(supabaseUrl) : null;
  const connectSrc = ["'self'", apiUrl, supabaseUrl, supabaseWs].filter(Boolean).join(" ");

  const csp = [
    "default-src 'self'",
    // 'strict-dynamic' + nonce: los scripts que el propio Next inyecta (con el nonce) pueden a su
    // vez cargar los suyos (chunks) sin tener que listarlos uno a uno.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    // Tailwind v4 compila a CSS de verdad (sin runtime), pero el estilo en línea (`style={{...}}`,
    // usado en Escudo.tsx y otros) va por el atributo `style`, que solo permite 'unsafe-inline'
    // (los nonce de CSP no cubren ese atributo). Google Fonts (Fraunces, salas /admin) carga su
    // hoja con un <link> a fonts.googleapis.com.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob:",
    // Fraunces (letra de las salas) sirve los ficheros de letra desde fonts.gstatic.com.
    "font-src 'self' https://fonts.gstatic.com",
    `connect-src ${connectSrc}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  // En petición: de aquí lo lee Next para firmar sus propios scripts inline con este nonce.
  requestHeaders.set("Content-Security-Policy-Report-Only", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  // En respuesta: de aquí lo lee el navegador.
  response.headers.set("Content-Security-Policy-Report-Only", csp);
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()",
  );

  return response;
}

export const config = {
  matcher: [
    // Todo salvo los estáticos de Next y los ficheros servidos tal cual (iconos, manifest, el
    // service worker): ahí no hay HTML que lea un nonce, así que generarlo es coste sin uso.
    "/((?!_next/static|_next/image|favicon\\.(?:ico|svg)|marca\\.svg|icon-|apple-touch-icon|sw\\.js|manifest\\.(?:json|webmanifest)).*)",
  ],
};
