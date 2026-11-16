"use client";

import { useCallback, useEffect, useState } from "react";
import { AgenteError, getAgente } from "./api";

export type EstadoCarga = "cargando" | "ok" | "error";

interface Resultado<T> { clave: string; datos?: T; error?: AgenteError }

/** Lee una ruta del agente. Con `ruta` nula no pide nada; al reintentar o cambiar de ruta vuelve a cargando. */
export function useCarga<T>(ruta: string | null) {
  const [resultado, setResultado] = useState<Resultado<T> | null>(null);
  const [intento, setIntento] = useState(0);
  const clave = `${ruta}#${intento}`;

  useEffect(() => {
    if (!ruta) return;
    let vivo = true;
    getAgente<T>(ruta).then(
      datos => { if (vivo) setResultado({ clave, datos }); },
      e => { if (vivo) setResultado({ clave, error: e instanceof AgenteError ? e : new AgenteError("red") }); },
    );
    return () => { vivo = false; };
  }, [ruta, clave]);

  const actual = resultado?.clave === clave ? resultado : null;
  const estado: EstadoCarga = !actual ? "cargando" : actual.error ? "error" : "ok";
  const recargar = useCallback(() => setIntento(n => n + 1), []);
  const poner = useCallback((datos: T) => setResultado({ clave, datos }), [clave]);
  return { estado, datos: actual?.datos ?? null, error: actual?.error ?? null, recargar, poner };
}
