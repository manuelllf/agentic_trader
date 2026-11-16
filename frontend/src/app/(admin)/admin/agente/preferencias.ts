"use client";

import { useCallback, useEffect, useState } from "react";

// Preferencia de este dispositivo: si Hoy enseña tu cartera de IBKR. Sin almacenamiento disponible
// (ventana privada, bloqueo), se enseña y el interruptor sigue funcionando durante la visita.
const CLAVE = "vennett.alphagentic.ibkrEnHoy";

function leer(): boolean {
  try {
    return window.localStorage.getItem(CLAVE) !== "0";
  } catch {
    return true;
  }
}

/** `null` hasta leer la preferencia: así nadie pide la cartera antes de saber si se quiere ver. */
export function useCarteraEnHoy(): [boolean | null, (visible: boolean) => void] {
  const [visible, setVisible] = useState<boolean | null>(null);
  useEffect(() => { setVisible(leer()); }, []);
  const cambiar = useCallback((v: boolean) => {
    setVisible(v);
    try {
      window.localStorage.setItem(CLAVE, v ? "1" : "0");
    } catch {
      // Sin almacenamiento la preferencia dura lo que dura la visita.
    }
  }, []);
  return [visible, cambiar];
}
