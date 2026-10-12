"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  activarAvisos, avisosSoportados, bajaAvisos, estadoAvisos,
} from "@/lib/liga/avisos";
import { Boton } from "../_ui";

type Estado = "cargando" | "no-disponible" | "bloqueado" | "apagado" | "activo";

/** Avisos de la liga en este navegador (Web Push, sin correo): se activan y se quitan aquí, uno por
 *  dispositivo. */
export function AvisosDispositivo() {
  const t = useTranslations();
  const [estado, setEstado] = useState<Estado>("cargando");
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

  return (
    <div className="form">
      <div className="campo">
        <span className="lbl">{t("account_avisos")}</span>
        <span className="nota">{t("account_avisos_ayuda")}</span>
        {estado === "no-disponible" && <span className="nota">{t("account_avisos_no_disponibles")}</span>}
        {estado === "bloqueado" && <span className="nota" role="status">{t("account_avisos_bloqueados")}</span>}
        {estado === "activo" && <span className="nota" role="status">{t("account_avisos_activos")}</span>}
        {error && <span className="aviso" role="alert">{error}</span>}
      </div>
      {estado === "apagado" && (
        <Boton type="button" ancho="completo" disabled={ocupado} onClick={() => void activar()}>
          {ocupado ? t("account_guardando") : t("account_avisos_activar")}
        </Boton>
      )}
      {estado === "activo" && (
        <Boton type="button" ancho="completo" disabled={ocupado} onClick={() => void desactivar()}>
          {ocupado ? t("account_guardando") : t("account_avisos_desactivar")}
        </Boton>
      )}
    </div>
  );
}
