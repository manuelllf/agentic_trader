"use client";

// Sesión y perfil (`Yo`) resueltos UNA sola vez por encima de todas las pantallas de `(liga)`
// (montado en `layout.tsx`), no en cada `page.tsx`: así cambiar de pestaña no repite
// `getSession` + `GET /liga/yo`, y `Sesion.tsx` no parpadea porque no se remonta.
//
// `estado` nunca vuelve a "cargando" tras la primera resolución: en un `onAuthStateChange`
// posterior (entrar, salir, refresco de token) se pasa directo a "fuera"/"dentro", así ninguna
// pantalla pierde por un instante lo último que sabía de la sesión.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { getYo, type Yo } from "@/lib/liga/api";
import { supabase, useSupabase } from "@/lib/liga/supabase";
import { invalidar, useCache } from "@/lib/liga/cache";

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
  const sb = useSupabase();
  const [estado, setEstado] = useState<EstadoSesion>("cargando");
  const [email, setEmail] = useState<string | null>(null);

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
      setEstado(data.session ? "dentro" : "fuera");
    });
    let uidAnterior: string | null | undefined;
    const { data: sub } = sb.auth.onAuthStateChange((_evento, sesion) => {
      setEmail(sesion?.user.email ?? null);
      setEstado(sesion ? "dentro" : "fuera");
      // Otra pestaña cerró o cambió de cuenta: lo cacheado era de la anterior.
      const uid = sesion?.user.id ?? null;
      if (uidAnterior !== undefined && uid !== uidAnterior) {
        invalidar("yo", "creditos", "mis-estrategias", "mis-ligas");
      }
      uidAnterior = uid;
    });
    return () => {
      vivo = false;
      clearTimeout(limite);
      sub.subscription.unsubscribe();
    };
  }, [sb]);

  const { datos: yo, refrescar } = useCache<Yo | null>(estado === "dentro" ? "yo" : null, getYo);

  const cerrarSesion = async () => {
    await supabase()?.auth.signOut();
    invalidar("yo", "creditos", "mis-estrategias", "mis-ligas");
    setEstado("fuera");
  };

  const valor = useMemo<ContextoSesion>(
    () => ({ estado, yo: yo ?? null, yoFallo: yo === null, email, refrescarYo: refrescar,
             cerrarSesion }),
    [estado, yo, email, refrescar],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
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
  useEffect(() => {
    if (ctx.estado === "fuera") window.location.replace(`/entrar?next=${encodeURIComponent(next)}`);
  }, [ctx.estado, next]);
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
