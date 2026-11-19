"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type EstadoLectura = "cargando" | "listo" | "error";

/** Una lectura al abrir la pantalla, con su estado: cada bloque de la pantalla carga y falla por su cuenta. */
export function useLectura<T>(leer: () => Promise<T>): { estado: EstadoLectura; datos: T | null } {
  const [lectura, setLectura] = useState<{ estado: EstadoLectura; datos: T | null }>({ estado: "cargando", datos: null });
  const leerRef = useRef(leer);
  useEffect(() => { leerRef.current = leer; });
  const cargar = useCallback(() => {
    let vivo = true;
    leerRef.current()
      .then(datos => { if (vivo) setLectura({ estado: "listo", datos }); })
      .catch(() => { if (vivo) setLectura({ estado: "error", datos: null }); });
    return () => { vivo = false; };
  }, []);
  useEffect(() => cargar(), [cargar]);
  return lectura;
}
