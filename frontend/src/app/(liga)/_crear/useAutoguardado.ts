"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { guardarBorrador, leerBorrador, type ContenidoBorrador } from "@/lib/liga/api";
import { supabase } from "@/lib/liga/supabase";

function serializar(contenido: ContenidoBorrador): string {
  return JSON.stringify(contenido, (_clave, valor) =>
    valor && typeof valor === "object" && !Array.isArray(valor)
      ? Object.fromEntries(Object.entries(valor).sort(([a], [b]) => a.localeCompare(b)))
      : valor);
}

export function useAutoguardado(clave: string, inicial: number | null, contenido: ContenidoBorrador | null) {
  const [estado, setEstado] = useState("Guardado");
  const revision = useRef(0);
  const confirmado = useRef("");
  const actual = useRef({ clave, texto: "", contenido });
  const listo = useRef(false);
  const pendiente = useRef<Promise<boolean> | null>(null);
  const bloqueado = useRef(false);
  const usuario = useRef<string | null>(null);
  const sesionValida = useRef(true);
  const texto = contenido ? serializar(contenido) : "";
  actual.current = { clave, texto, contenido };

  const guardar = useCallback(async (): Promise<boolean> => {
    if (pendiente.current) return pendiente.current;
    if (!listo.current || !actual.current.contenido || bloqueado.current) return !bloqueado.current;
    if (!usuario.current || !sesionValida.current) return false;
    pendiente.current = (async () => {
      while (sesionValida.current && actual.current.texto !== confirmado.current) {
        const copia = actual.current;
        setEstado("Guardando…");
        const r = await guardarBorrador(copia.clave, revision.current, copia.contenido!, usuario.current!);
        if (typeof r === "string") {
          bloqueado.current = true;
          setEstado(r);
          return false;
        }
        revision.current = r.revision;
        confirmado.current = copia.texto;
      }
      setEstado("Guardado");
      return sesionValida.current;
    })();
    try { return await pendiente.current; } finally { pendiente.current = null; }
  }, []);

  useEffect(() => {
    const sb = supabase();
    if (!sb) { sesionValida.current = false; return; }
    const { data } = sb.auth.onAuthStateChange((_evento, sesion) => {
      const uid = sesion?.user.id ?? null;
      if (!usuario.current && uid && sesionValida.current) usuario.current = uid;
      else if (uid !== usuario.current) sesionValida.current = false;
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (inicial === null || !texto) return;
    if (!listo.current) {
      revision.current = inicial;
      confirmado.current = texto;
      listo.current = true;
      return;
    }
    if (texto === confirmado.current) return;
    setEstado("Cambios pendientes");
    const timer = setTimeout(() => { void guardar(); }, 700);
    return () => clearTimeout(timer);
  }, [inicial, texto, guardar]);

  useEffect(() => {
    const antes = (e: BeforeUnloadEvent) => {
      if (listo.current && confirmado.current !== actual.current.texto) { e.preventDefault(); }
    };
    window.addEventListener("beforeunload", antes);
    return () => { window.removeEventListener("beforeunload", antes); void guardar(); };
  }, [guardar]);

  return { estado, guardar, revision,
    reintentar: async () => {
      if (!sesionValida.current) return;
      const remoto = await leerBorrador(actual.current.clave);
      if (remoto && typeof remoto !== "string" && serializar(remoto.contenido) === actual.current.texto) {
        revision.current = remoto.revision;
        confirmado.current = actual.current.texto;
        bloqueado.current = false;
        setEstado("Guardado");
        return;
      }
      bloqueado.current = false;
      void guardar();
    } };
}
