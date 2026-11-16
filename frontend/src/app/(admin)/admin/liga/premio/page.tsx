"use client";

// Premio anual: el reparto de cada temporada cerrada, con el correo de quien cobra para contactarla
// y verificar su identidad. El pago queda fuera del producto. Un botón de reserva por si el cálculo
// automático falló; el normal corre solo al cerrar la última jornada.

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useConfirmar } from "@/components/Confirmar";
import { ApiError, get, post } from "@/lib/api";
import { euros, numero, porcentajeConSigno } from "../../_marco/formato";
import { Celda, Esqueleto, Grupo, Progreso, Segmentado, Vacio } from "../../_panel/ui";
import "../pl.css";

type Temporada = { id: number; nombre: string; estado: string; calculado: boolean;
                   escalon: number | null; elegibles: number };
type Fila = { cuenta: string; alias: string; jornadas_jugadas: number; rentabilidad: string;
              puesto: number | null; importe: string | null; email: string | null };
type Estado = { temporadas: Temporada[]; temporada_id: number | null; umbral_basico: number;
                umbral_completo: number; visible: boolean; filas: Fila[] };

const error = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

function Escalon({ titulo, actual, umbral }: { titulo: string; actual: number; umbral: number }) {
  const t = useTranslations();
  const locale = useLocale();
  return (
    <li>
      <div className="pl-prog">
        <div className="pl-prog-fila"><span>{titulo}</span><span>{t("pnl_liga_n_cuentas", { n: numero(umbral, locale) })}</span></div>
        <Progreso valor={umbral ? (actual / umbral) * 100 : 0} etiqueta={titulo} />
      </div>
    </li>
  );
}

export default function PremioAdmin() {
  const t = useTranslations();
  const { confirmar, dialogo } = useConfirmar();
  const locale = useLocale();
  const [estado, setEstado] = useState<Estado | null>(null);
  const [fallo, setFallo] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback((temporadaId?: number) => {
    setFallo("");
    const ruta = temporadaId ? `?temporada_id=${temporadaId}` : "";
    get<Estado>(`/liga/admin/procesos/premio/estado${ruta}`).then(setEstado)
      .catch((e) => setFallo(error(e, t("admin_generic_error"))));
  }, [t]);
  useEffect(() => cargar(), [cargar]);

  const calcular = async (id: number) => {
    if (!(await confirmar({ titulo: t("admin_prize_confirm_calculate"), aceptar: t("common_confirmar") }))) return;
    setOcupado(true); setFallo("");
    try {
      await post(`/liga/admin/procesos/premio/ejecutar`, { temporada_id: id });
      cargar(id);
    } catch (e) { setFallo(error(e, t("admin_generic_error"))); } finally { setOcupado(false); }
  };

  const elegida = estado?.temporadas.find((x) => x.id === estado.temporada_id);
  const cierrePendiente = estado?.temporadas.filter((x) => x.estado === "cerrada" && !x.calculado) ?? [];
  const elegibles = elegida?.elegibles ?? 0;

  return (
    <div className="pnl-llega">
      {fallo && <p className="pnl-pie-grupo" role="alert">{fallo}</p>}
      {!estado && !fallo && <Esqueleto filas={4} etiqueta={t("admin_pnl_cargando")} />}
      {estado && (
        <>
          {estado.temporadas.length > 1 && (
            <Segmentado etiquetaGrupo={t("admin_prize_seasons")} valor={String(estado.temporada_id)}
              opciones={estado.temporadas.map(x => ({ valor: String(x.id), etiqueta: x.nombre }))} onChange={id => cargar(Number(id))} />
          )}
          <div className="pl-cifra">
            {elegida && <small>{elegida.nombre}</small>}
            <b>{numero(elegibles, locale)} / {numero(elegibles < estado.umbral_basico ? estado.umbral_basico : estado.umbral_completo, locale)}</b>
            <p>{t(elegibles < estado.umbral_basico ? "pnl_liga_premio_hacia_basico" : "pnl_liga_premio_hacia_completo")}</p>
          </div>
          <ul className="pnl-grupo" style={{ marginTop: 16 }}>
            <Escalon titulo={t("admin_prize_basic")} actual={elegibles} umbral={estado.umbral_basico} />
            <Escalon titulo={t("admin_prize_full")} actual={elegibles} umbral={estado.umbral_completo} />
          </ul>
          <Grupo>
            <Celda titulo={t("pnl_liga_visibilidad")} valor={t(estado.visible ? "admin_prize_shown" : "admin_prize_hidden")} />
          </Grupo>

          <Grupo cabecera={t("pnl_liga_reparto")} pie={t("pnl_liga_premio_pie")}>
            {cierrePendiente.length === 0 && (
              <Celda titulo={t("pnl_liga_calcular_titulo")} subtitulo={t("pnl_liga_calcular_cuando")} deshabilitada />
            )}
            {cierrePendiente.map(x => (
              <Celda key={x.id} titulo={t("admin_prize_calculate")} subtitulo={t("admin_prize_pending", { name: x.nombre })} tono="accion"
                deshabilitada={ocupado} onClick={() => void calcular(x.id)} />
            ))}
          </Grupo>

          {!elegida?.calculado ? <Vacio titulo={t("admin_prize_none")} /> : (
            <Grupo>
              {estado.filas.map(f => (
                <Celda key={f.cuenta} titulo={`${f.puesto != null ? `${f.puesto}. ` : ""}${f.alias}`}
                  subtitulo={[porcentajeConSigno(f.rentabilidad, locale), t("pnl_liga_n_jornadas", { n: f.jornadas_jugadas }), f.email].filter(Boolean).join(" · ")}
                  valor={f.importe != null ? euros(f.importe, locale) : undefined} />
              ))}
            </Grupo>
          )}
        </>
      )}
      {dialogo}
    </div>
  );
}
