"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  activarAvisos, avisosSoportados, bajaAvisos, estadoAvisos,
} from "@/lib/liga/avisos";

export type EstadoPush = "cargando" | "no-disponible" | "bloqueado" | "apagado" | "activo";

/** Push de la liga en este navegador (Web Push, uno por dispositivo): su estado y cómo activarlo o
 *  quitarlo. Lo usan la fila de Cuenta, para el resumen, y la página de avisos. */
export function usePushDispositivo() {
  const t = useTranslations();
  const [estado, setEstado] = useState<EstadoPush>("cargando");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      if (!avisosSoportados()) { if (vivo) setEstado("no-disponible"); return; }
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        const servidor = await estadoAvisos();
        if (!vivo) return;
        if (sub && typeof servidor === "object" && servidor.dispositivos.includes(sub.endpoint)) {
          setEstado("activo");
        } else {
          setEstado(Notification.permission === "denied" ? "bloqueado" : "apagado");
        }
      } catch {
        if (vivo) setEstado("apagado");
      }
    })();
    return () => { vivo = false; };
  }, []);

  async function activar() {
    setOcupado(true);
    setError(null);
    try {
      const resultado = await activarAvisos();
      if (resultado === "bloqueado") setEstado("bloqueado");
      else if (resultado === "error") setError(t("account_avisos_error"));
      else if (resultado === null) setEstado("activo");
    } finally {
      setOcupado(false);
    }
  }

  async function desactivar() {
    setOcupado(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const r = await bajaAvisos(sub.endpoint);
        if (typeof r === "string") { setError(r); return; }
        await sub.unsubscribe();
      }
      setEstado("apagado");
    } catch {
      setError(t("account_avisos_error"));
    } finally {
      setOcupado(false);
    }
  }

  return { estado, ocupado, error, activar, desactivar };
}
