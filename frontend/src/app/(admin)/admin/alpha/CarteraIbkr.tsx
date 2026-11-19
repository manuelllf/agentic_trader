"use client";

// Tu cartera real de IBKR, en solo lectura. La sirve el backend de Vennett, como en la sala Alpha:
// el servicio del agente no la ve ni la toca.
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { getPersonal, syncPersonal } from "@/lib/api";
import type { PersonalSummary } from "@/lib/types";
import { dolares, dolaresConSigno } from "../_marco/formato";
import { Celda, Datos, Esqueleto, Grupo } from "../_panel/ui";
import { aNumero, tonoDe } from "./formato";

type Estado = "cargando" | "ok" | "error";

export function CarteraIbkr() {
  const t = useTranslations();
  const locale = useLocale();
  const [estado, setEstado] = useState<Estado>("cargando");
  const [datos, setDatos] = useState<PersonalSummary | null>(null);
  const [sincronizando, setSincronizando] = useState(false);
  const [falloSync, setFalloSync] = useState(false);

  const cargar = useCallback(async () => {
    setEstado("cargando");
    try {
      setDatos(await getPersonal());
      setEstado("ok");
    } catch {
      setEstado("error");
    }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  const sincronizar = async () => {
    setSincronizando(true);
    setFalloSync(false);
    try {
      setDatos(await syncPersonal());
      setEstado("ok");
    } catch {
      setFalloSync(true);
    } finally {
      setSincronizando(false);
    }
  };

  const cabecera = t("pnl_agente_ibkr_cab");
  if (estado === "cargando") {
    return <><h2 className="pnl-cab-grupo">{cabecera}</h2><Esqueleto filas={3} etiqueta={t("pnl_agente_cargando")} /></>;
  }
  if (estado === "error" || !datos) {
    return (
      <Grupo cabecera={cabecera} pie={t("pnl_agente_ibkr_error_pie")}>
        <Celda titulo={t("pnl_agente_ibkr_error")} />
        <Celda titulo={t("pnl_agente_reintentar")} tono="accion" onClick={() => void cargar()} />
      </Grupo>
    );
  }

  const posiciones = [...(datos.positions ?? [])].sort((a, b) => aNumero(b.value) - aNumero(a.value));
  const pnl = aNumero(datos.total_unrealized_pnl);
  return (
    <div className="pa-ibkr">
      <h2 className="pnl-cab-grupo">{cabecera}</h2>
      <Datos items={[
        { etiqueta: t("pnl_agente_ibkr_valor"), valor: dolares(datos.total_value, locale) },
        { etiqueta: t("pnl_agente_ibkr_pnl"), valor: <span className={tonoDe(pnl)}>{dolaresConSigno(pnl, locale)}</span> },
      ]} />
      <Grupo className="pa-ibkr-lista" pie={falloSync ? t("pnl_agente_ibkr_sync_fallo") : t("pnl_agente_ibkr_pie")}>
        {posiciones.length > 0 ? posiciones.map(p => (
          <Celda key={`${p.ticker}-${p.description}`} titulo={p.ticker}
            valor={p.value != null ? dolares(p.value, locale) : "-"}
            subtitulo={t("pnl_agente_ibkr_pos_sub", {
              acciones: new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(aNumero(p.quantity)),
              precio: p.price != null ? dolares(p.price, locale) : "-",
              pnl: p.unrealized_pnl != null ? dolaresConSigno(p.unrealized_pnl, locale) : "-",
            })} />
        )) : <Celda titulo={t("pnl_agente_ibkr_vacio")} />}
        <Celda titulo={t(sincronizando ? "pnl_agente_ibkr_sincronizando" : "pnl_agente_ibkr_sync")} tono="accion"
          onClick={sincronizando ? undefined : () => void sincronizar()} deshabilitada={sincronizando} />
      </Grupo>
    </div>
  );
}
