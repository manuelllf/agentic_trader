import { llamar } from "./api";

/** Dispositivos de la cuenta con avisos activados (sus endpoints) y cuántos se admiten. */
export type EstadoAvisos = { dispositivos: string[]; maximo: number; resumen_correo?: boolean };

export const probarAvisoCuenta = () =>
  llamar<{ dispositivos: number; ok: number; baja: number; error: number }>(
    "/liga/avisos/probar", { method: "POST" });

export const claveAvisos = () => llamar<{ key: string }>("/liga/avisos/clave");

export const estadoAvisos = () => llamar<EstadoAvisos>("/liga/avisos");

export const cambiarResumenCorreo = (activo: boolean) =>
  llamar<{ resumen_correo: boolean }>("/liga/avisos/resumen",
    { method: "PATCH", body: JSON.stringify({ activo }) });

export const suscribirAvisos = (sub: PushSubscriptionJSON) =>
  llamar<EstadoAvisos>("/liga/avisos/suscribir", { method: "POST", body: JSON.stringify(sub) });

export const bajaAvisos = (endpoint: string) =>
  llamar<EstadoAvisos>("/liga/avisos/baja", { method: "POST", body: JSON.stringify({ endpoint }) });

/** Avisos por correo de la cuenta; `correo` nulo es el de la propia cuenta. */
export const guardarAvisosCorreo = (activo: boolean, correo: string | null) =>
  llamar<{ activo: boolean; correo: string | null }>("/liga/yo/avisos-correo",
    { method: "PUT", body: JSON.stringify({ activo, correo }) });

/** ¿Este navegador puede recibir avisos? (En iPhone, solo con la app añadida a la pantalla de inicio.) */
export function avisosSoportados(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator
    && "PushManager" in window && "Notification" in window;
}

/** La clave pública VAPID en el formato que pide `pushManager.subscribe`. */
export function claveAServidor(clave: string): BufferSource {
  const relleno = "=".repeat((4 - (clave.length % 4)) % 4);
  const crudo = atob((clave + relleno).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(crudo, (c) => c.charCodeAt(0)) as BufferSource;
}

/** `null` si quedó activado; «bloqueado» si el navegador lo niega; «cancelado» si se cierra el
 *  permiso sin responder; «error» en cualquier otro caso. */
export async function activarAvisos(): Promise<"bloqueado" | "cancelado" | "error" | null> {
  try {
    const permiso = await Notification.requestPermission();
    if (permiso === "denied") return "bloqueado";
    if (permiso !== "granted") return "cancelado";
    const reg = await navigator.serviceWorker.ready;
    const clave = await claveAvisos();
    if (typeof clave === "string") return "error";
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true, applicationServerKey: claveAServidor(clave.key),
    });
    const resultado = await suscribirAvisos(sub.toJSON());
    if (typeof resultado === "string") {
      // Sin suscripción a medias: el servidor no la guardó.
      try { await sub.unsubscribe(); } catch { /* El error de fondo ya se devuelve abajo. */ }
      return "error";
    }
    return null;
  } catch {
    return "error";
  }
}

export function marcarAvisosPreguntados() {
  try { localStorage.setItem("vennett.avisos.preguntado", "1"); } catch { /* El alta puede seguir sin almacenamiento. */ }
}

export function yaPreguntado(): boolean {
  try { return localStorage.getItem("vennett.avisos.preguntado") === "1"; } catch { return false; }
}

export function esIphoneFueraDeInicio(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  return /iPad|iPhone|iPod/i.test(navigator.userAgent)
    && (navigator as Navigator & { standalone?: boolean }).standalone !== true
    && !window.matchMedia?.("(display-mode: standalone)").matches;
}

type ContextoAvisosAlta = {
  origen: "confirmar" | "resto";
  destino: string;
  soportado: boolean;
  iphoneFuera: boolean;
  permiso: NotificationPermission | "no-disponible";
  preguntado: boolean;
  suscrito: boolean;
};

export function pantallaAvisosAlta(c: ContextoAvisosAlta): "avisos" | "ios" | null {
  if (c.origen === "confirmar" && c.destino !== "/liga") return null;
  if (c.preguntado || c.suscrito) return null;
  if (!c.soportado) return c.iphoneFuera ? "ios" : null;
  if (c.permiso === "denied") return null;
  return "avisos";
}

export async function avisosAltaPara(
  origen: ContextoAvisosAlta["origen"], destino: string,
): Promise<"avisos" | "ios" | null> {
  const soportado = avisosSoportados();
  const permiso = typeof Notification === "undefined" ? "no-disponible" : Notification.permission;
  let suscrito = false;
  try {
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.ready;
      suscrito = Boolean(await reg.pushManager.getSubscription());
    }
  } catch { /* Si no se puede consultar, se permite preguntar. */ }
  return pantallaAvisosAlta({ origen, destino, soportado, permiso,
    iphoneFuera: esIphoneFueraDeInicio(), preguntado: yaPreguntado(), suscrito });
}

export async function destinoConAvisos(origen: ContextoAvisosAlta["origen"], destino: string): Promise<string> {
  const variante = await avisosAltaPara(origen, destino);
  return variante ? "/avisos-alta?next=" + encodeURIComponent(destino) : destino;
}
