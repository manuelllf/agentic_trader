import { llamar } from "./api";

/** Dispositivos de la cuenta con avisos activados (sus endpoints) y cuántos se admiten. */
export type EstadoAvisos = { dispositivos: string[]; maximo: number };

export const claveAvisos = () => llamar<{ key: string }>("/liga/avisos/clave");

export const estadoAvisos = () => llamar<EstadoAvisos>("/liga/avisos");

export const suscribirAvisos = (sub: PushSubscriptionJSON) =>
  llamar<EstadoAvisos>("/liga/avisos/suscribir", { method: "POST", body: JSON.stringify(sub) });

export const bajaAvisos = (endpoint: string) =>
  llamar<EstadoAvisos>("/liga/avisos/baja", { method: "POST", body: JSON.stringify({ endpoint }) });

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
