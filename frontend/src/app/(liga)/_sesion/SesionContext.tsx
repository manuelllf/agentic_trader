"use client";

// Sesión y perfil (`Yo`) resueltos UNA sola vez por encima de todas las pantallas de `(liga)`
// (montado en `layout.tsx`), no en cada `page.tsx`: así cambiar de pestaña no repite
// `getSession` + `GET /liga/yo`, y `Sesion.tsx` no parpadea porque no se remonta.
//
// `estado` nunca vuelve a "cargando" tras la primera resolución: en un `onAuthStateChange`
// posterior (entrar, salir, refresco de token) se pasa directo a "fuera"/"dentro", así ninguna
// pantalla pierde por un instante lo último que sabía de la sesión.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { debeCompletarCuenta } from "@/lib/liga/cuenta";
import { sessionViewKey } from "@/lib/liga/sessionView";
import { getYo, type Yo } from "@/lib/liga/api";
import { supabase, tokenSesion, useSupabase } from "@/lib/liga/supabase";
import { limpiarPrivado, useCache } from "@/lib/liga/cache";
import { useLanguage } from "@/i18n/Provider";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const INTERVALO_ACTIVIDAD_MS = 60_000;

async function registrarVisita(): Promise<void> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const sesion = await tokenSesion(ctrl.signal);
    if (!sesion) return;
    await fetch(`${API_URL}/liga/visitas/actividad`, {
      method: "POST",
      headers: { Authorization: `Bearer ${sesion.token}` },
      cache: "no-store",
      keepalive: true,
      signal: ctrl.signal,
    });
  } catch {
    // La auditoría no debe impedir el uso de la cuenta ni cambiar su estado de sesión.
  } finally {
    clearTimeout(timer);
  }
}

export type EstadoSesion = "cargando" | "fuera" | "dentro";

type ContextoSesion = {
  estado: EstadoSesion;
  yo: Yo | null;
  /** Con sesión, pero `GET /liga/yo` no ha dado nada: para enseñar un error con salida en vez de
   *  un esqueleto eterno. */
  yoFallo: boolean;
  email: string | null;
  refrescarYo: () => void;
  cerrarSesion: () => Promise<void>;
};

const Contexto = createContext<ContextoSesion | null>(null);

export function SesionProvider({ children }: { children: ReactNode }) {
  const { setAccount } = useLanguage();
  const sb = useSupabase();
  const pathname = usePathname();
  const router = useRouter();
  const [estado, setEstado] = useState<EstadoSesion>("cargando");
  const [email, setEmail] = useState<string | null>(null);
  const [uid, setUid] = useState<string | null>(null);

  useEffect(() => {
    if (sb === undefined) return;
    if (sb === null) {
      setEstado("fuera");
      return;
    }
    let vivo = true;
    // Si la sesión no llega a resolverse (red, almacenamiento bloqueado), no se queda todo en
    // blanco esperándola: se sigue como visitante.
    const limite = setTimeout(() => setEstado((e) => (e === "cargando" ? "fuera" : e)), 6000);
    sb.auth.getSession().then(({ data }) => {
      if (!vivo) return;
      setEmail(data.session?.user.email ?? null);
      setUid(data.session?.user.id ?? null);
      setEstado(data.session ? "dentro" : "fuera");
    });
    let uidAnterior: string | null | undefined;
    const { data: sub } = sb.auth.onAuthStateChange((_evento, sesion) => {
      setEmail(sesion?.user.email ?? null);
      setUid(sesion?.user.id ?? null);
      setEstado(sesion ? "dentro" : "fuera");
      // Otra pestaña cerró o cambió de cuenta: lo cacheado era de la anterior.
      const uid = sesion?.user.id ?? null;
      if (uidAnterior !== undefined && uid !== uidAnterior) {
        limpiarPrivado();
      }
      uidAnterior = uid;
    });
    return () => {
      vivo = false;
      clearTimeout(limite);
      sub.subscription.unsubscribe();
    };
  }, [sb]);

  // La sesión restaurada cuenta igual que una recién iniciada. Los siguientes avisos salen de
  // interacción humana o de volver a una pestaña visible; no hay sondeo en segundo plano.
  useEffect(() => {
    if (estado !== "dentro" || !uid) return;
    let ultimoEnvio = 0;
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    let vivo = true;
    const enviar = () => {
      if (!vivo || document.visibilityState !== "visible") return;
      ultimoEnvio = Date.now();
      void registrarVisita();
    };
    const actividadHumana = () => {
      if (document.visibilityState !== "visible" || temporizador) return;
      const espera = Math.max(0, INTERVALO_ACTIVIDAD_MS - (Date.now() - ultimoEnvio));
      temporizador = setTimeout(() => {
        temporizador = undefined;
        enviar();
      }, espera);
    };
    const cambioVisibilidad = () => {
      if (document.visibilityState !== "visible") {
        if (temporizador) clearTimeout(temporizador);
        temporizador = undefined;
      } else if (Date.now() - ultimoEnvio >= INTERVALO_ACTIVIDAD_MS) {
        enviar();
      }
    };

    enviar();
    const eventos: (keyof WindowEventMap)[] = ["pointerdown", "keydown", "touchstart", "scroll"];
    eventos.forEach((evento) => window.addEventListener(evento, actividadHumana, { passive: true }));
    document.addEventListener("visibilitychange", cambioVisibilidad);
    return () => {
      vivo = false;
      if (temporizador) clearTimeout(temporizador);
      eventos.forEach((evento) => window.removeEventListener(evento, actividadHumana));
      document.removeEventListener("visibilitychange", cambioVisibilidad);
    };
  }, [estado, uid]);

  const { datos: yo, fallo: yoFalla, refrescar } =
    useCache<Yo | null>(estado === "dentro" ? "yo" : null, getYo);

  useEffect(() => {
    if (estado === "fuera") setAccount(null);
    else if (uid && yo) setAccount({ id: uid, locale: yo.idioma ?? null });
  }, [estado, uid, yo, setAccount]);

  useEffect(() => {
    if (estado === "dentro" && debeCompletarCuenta(yo?.pendiente === true, pathname)) {
      router.replace(`/completar?next=${encodeURIComponent(pathname + window.location.search)}`);
    }
  }, [estado, yo?.pendiente, pathname, router]);

  const cerrarSesion = async () => {
    await supabase()?.auth.signOut();
    limpiarPrivado();
    setEstado("fuera");
  };

  const valor = useMemo<ContextoSesion>(
    () => ({ estado, yo: yo ?? null, yoFallo: yoFalla || yo === null, email,
             refrescarYo: refrescar, cerrarSesion }),
    [estado, yo, yoFalla, email, refrescar],
  );

  return <Contexto.Provider value={valor}><div key={sessionViewKey(pathname, uid)} className="sesion-contenido">{children}</div></Contexto.Provider>;
}

export function useSesion(): ContextoSesion {
  const ctx = useContext(Contexto);
  if (!ctx) throw new Error("useSesion() solo vale dentro de <SesionProvider>.");
  return ctx;
}

/** Para pantallas que exigen sesión: en cuanto se sabe que no hay, manda a `/entrar?next=...`
 *  (mismo destino de siempre) sin tener que repetir el `getSession` en cada `page.tsx`. */
export function useSesionRequerida(next: string): ContextoSesion {
  const ctx = useSesion();
  const router = useRouter();
  useEffect(() => {
    if (ctx.estado === "fuera") router.replace(`/entrar?next=${encodeURIComponent(next)}`);
  }, [ctx.estado, next, router]);
  return ctx;
}

/** Para la portada (D3, `(liga)/page.tsx`): en cuanto hay sesión, salta a `/liga` sin enseñar
 *  nada de la portada mientras tanto (igual que antes, sin parpadeo). */
export function useRedirigirSiHaySesion(): EstadoSesion {
  const { estado } = useSesion();
  const router = useRouter();
  useEffect(() => {
    if (estado === "dentro") router.replace("/liga");
  }, [estado, router]);
  return estado;
}
