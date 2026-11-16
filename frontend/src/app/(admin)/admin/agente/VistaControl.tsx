"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useConfirmar } from "@/components/Confirmar";
import { Celda, CeldaInterruptor, Grupo, Progreso } from "../_panel/ui";
import { useCarteraEnHoy } from "./preferencias";
import { AgenteError, postAgente } from "./api";
import { Carga } from "./Comun";
import { aNumero, dinero, fecha } from "./formato";
import type { AgenteVista, Control } from "./tipos";
import { useCarga } from "./useCarga";

type Traducir = ReturnType<typeof useTranslations>;

/** Cuánto del tope mensual lleva gastado, de 0 a 100. Sin tope válido no hay barra. */
export function usoDelTope(gastado: string | number, tope: string | number): number {
  const g = aNumero(gastado), tp = aNumero(tope);
  return tp > 0 ? Math.min(100, (g / tp) * 100) : 0;
}

function Presupuesto({ gasto, locale, t }: { gasto: AgenteVista["gasto_mes"]; locale: string; t: Traducir }) {
  const uso = usoDelTope(gasto.total_usd, gasto.tope_usd);
  return (
    <Grupo cabecera={t("pnl_agente_ctl_presupuesto_cab")} pie={t("pnl_agente_ctl_presupuesto_pie")}>
      <li>
        <div className="pnl-celda pa-presupuesto">
          <span className="t"><b>{t("pnl_agente_ctl_gastado")}</b></span>
          <span className="valor">{t("pnl_agente_ctl_gasto_valor", { gastado: dinero(gasto.total_usd, locale), tope: dinero(gasto.tope_usd, locale) })}</span>
          <span className={`pa-barra${uso >= 80 ? " cerca" : ""}`}><Progreso valor={uso} etiqueta={t("pnl_agente_ctl_presupuesto_aria")} /></span>
        </div>
      </li>
      {gasto.por_tipo.map(g => (
        <Celda key={g.tipo} titulo={t(`pnl_agente_ctl_tipo_${g.tipo}`)} valor={dinero(g.coste_usd, locale)} />
      ))}
    </Grupo>
  );
}

function Estado({ c: inicial, locale, t }: { c: Control; locale: string; t: Traducir }) {
  const { confirmar, pedirTexto, dialogo } = useConfirmar();
  const [c, setC] = useState(inicial);
  const [ocupado, setOcupado] = useState(false);
  const [fallo, setFallo] = useState(false);

  const cambiar = async (parada: boolean, motivo: string) => {
    setOcupado(true);
    setFallo(false);
    try {
      setC(await postAgente<Control>("/v1/control/parada", { parada, motivo }));
    } catch (e) {
      if (!(e instanceof AgenteError)) throw e;
      setFallo(true);
    } finally {
      setOcupado(false);
    }
  };
  const parar = async () => {
    const motivo = await pedirTexto({
      titulo: t("pnl_agente_ctl_parar_titulo"), texto: t("pnl_agente_ctl_parar_texto"),
      etiqueta: t("pnl_agente_ctl_parar_etiqueta"), aceptar: t("pnl_agente_ctl_parar_aceptar"), max: 500,
    });
    if (motivo !== null) await cambiar(true, motivo);
  };
  const reanudar = async () => {
    const ok = await confirmar({ titulo: t("pnl_agente_ctl_reanudar_titulo"), texto: t("pnl_agente_ctl_reanudar_texto"), aceptar: t("pnl_agente_ctl_reanudar_aceptar") });
    if (ok) await cambiar(false, "");
  };
  const revertir = async () => {
    const ok = await confirmar({ titulo: t("pnl_agente_ctl_revertir_titulo"), texto: t("pnl_agente_ctl_revertir_texto"), aceptar: t("pnl_agente_ctl_revertir_aceptar") });
    if (!ok) return;
    setOcupado(true);
    setFallo(false);
    try {
      setC(await postAgente<Control>("/v1/control/filosofia/revertir", {}));
    } catch (e) {
      if (!(e instanceof AgenteError)) throw e;
      setFallo(true);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <>
      <Grupo cabecera={t("pnl_agente_ctl_estado_cab")} pie={t("pnl_agente_ctl_servicio_pie")}>
        <Celda titulo={t("pnl_agente_ctl_agente")} valor={t(c.parada ? "pnl_agente_ctl_parado" : "pnl_agente_ctl_activo")}
          subtitulo={c.parada && c.motivo ? c.motivo : undefined} tono={c.parada ? "peligro" : "normal"} />
        <Celda titulo={t("pnl_agente_ctl_modo")} valor={t(`pnl_agente_ctl_modo_${c.modo}`)} subtitulo={t("pnl_agente_ctl_modo_sub")} />
        <Celda titulo={t("pnl_agente_ctl_ia")} valor={t(c.ia_activa ? "pnl_agente_ctl_ia_activa" : "pnl_agente_ctl_ia_apagada")} />
        <Celda titulo={t("pnl_agente_ctl_sombra")} valor={t(c.sombra ? "pnl_agente_ctl_si" : "pnl_agente_ctl_no")}
          subtitulo={t(c.sombra ? "pnl_agente_ctl_sombra_si" : "pnl_agente_ctl_sombra_no")} />
        {c.actualizado_en && <Celda titulo={t("pnl_agente_ctl_cambio")} valor={fecha(c.actualizado_en, locale)} />}
      </Grupo>
      <Grupo pie={fallo ? t("pnl_agente_ctl_fallo") : c.parada ? t("pnl_agente_ctl_reanudar_pie") : t("pnl_agente_ctl_parar_pie")} className="pa-parada">
        {c.parada
          ? <Celda titulo={t("pnl_agente_ctl_reanudar")} tono="accion" onClick={ocupado ? undefined : reanudar} deshabilitada={ocupado} />
          : <Celda titulo={t("pnl_agente_ctl_parar")} tono="peligro" onClick={ocupado ? undefined : parar} deshabilitada={ocupado} />}
      </Grupo>
      {(c.mejora || c.revertible) && (
        <Grupo cabecera={t("pnl_agente_ctl_filosofia_cab")} pie={c.revertible ? t("pnl_agente_ctl_revertir_pie") : undefined}>
          {c.mejora && (
            <Celda titulo={t(c.mejora.estado === "en_sombra" ? "pnl_agente_ctl_mejora_sombra" : "pnl_agente_ctl_mejora_propuesta")}
              subtitulo={c.mejora.hipotesis}
              valor={c.mejora.estado === "en_sombra" && c.mejora.sombra_hasta ? t("pnl_agente_ctl_mejora_hasta", { fecha: fecha(c.mejora.sombra_hasta, locale) }) : undefined} />
          )}
          {c.revertible && <Celda titulo={t("pnl_agente_ctl_revertir")} tono="peligro" onClick={ocupado ? undefined : revertir} deshabilitada={ocupado} />}
        </Grupo>
      )}
      {dialogo}
    </>
  );
}

function PreferenciaIbkr({ t }: { t: Traducir }) {
  const [visible, cambiar] = useCarteraEnHoy();
  // Hasta leer la preferencia no se pinta el interruptor: si cambiara de apagado a encendido
  // en pantalla, quedaba una imagen a medias (dos interruptores).
  if (visible === null) return null;
  return (
    <Grupo cabecera={t("pnl_agente_ctl_ibkr_cab")}>
      <CeldaInterruptor titulo={t("pnl_agente_ctl_ibkr")} subtitulo={t("pnl_agente_ctl_ibkr_sub")} activo={visible}
        onCambio={cambiar} />
    </Grupo>
  );
}

export default function VistaControl() {
  const t = useTranslations();
  const locale = useLocale();
  const control = useCarga<Control>("/v1/control");
  const agente = useCarga<AgenteVista>("/v1/agente");
  // Las dos lecturas se piden a la vez; basta con que falle una para enseñar el vacío real.
  const estado = control.estado === "error" || agente.estado === "error" ? "error" : control.estado === "ok" && agente.estado === "ok" ? "ok" : "cargando";
  const conjunto = control.datos && agente.datos ? { c: control.datos, a: agente.datos } : null;
  return (
    <Carga estado={estado} datos={conjunto} error={control.error ?? agente.error}
      recargar={() => { control.recargar(); agente.recargar(); }} filas={5}>
      {({ c, a }) => (
        <div className="pa-control">
          <Estado c={c} locale={locale} t={t} />
          <Presupuesto gasto={a.gasto_mes} locale={locale} t={t} />
          <PreferenciaIbkr t={t} />
        </div>
      )}
    </Carga>
  );
}
