"use client";

// Premio anual: el reparto de cada temporada cerrada, con el correo de quien cobra para contactarla
// y verificar su identidad. El pago queda fuera del producto. Un botón de reserva por si el cálculo
// automático falló; el normal corre solo al cerrar la última jornada.

import { Bloque, Boton, Chip, Cifra, Cifras, Estado as EstadoUI, Pagina, Segmentos } from "../../_marco/ui";
import { euros, numero, porcentajeConSigno } from "../../_marco/formato";
import { useConfirmar } from "@/components/Confirmar";
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import AuthGate from "@/components/AuthGate";
import { ApiError, get, post } from "@/lib/api";

type Temporada = { id: number; nombre: string; estado: string; calculado: boolean;
                   escalon: number | null; elegibles: number };
type Fila = { cuenta: string; alias: string; jornadas_jugadas: number; rentabilidad: string;
              puesto: number | null; importe: string | null; email: string | null };
type Estado = { temporadas: Temporada[]; temporada_id: number | null; umbral_basico: number;
                umbral_completo: number; visible: boolean; filas: Fila[] };

const error = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

function Premio() {
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

  return <Pagina repetido titulo={t("admin_prize_title")}>
    {fallo && <EstadoUI tipo="error">{fallo}</EstadoUI>}
    {!estado ? !fallo && <EstadoUI tipo="cargando" /> : <>
      {estado.visible ? <Chip tono="bien">{t("admin_prize_shown")}</Chip> : <Chip>{t("admin_prize_hidden")}</Chip>}
      <Cifras><Cifra etiqueta={t("admin_prize_eligible")} valor={numero(elegida?.elegibles ?? 0, locale)} /><Cifra etiqueta={t("admin_prize_basic")} valor={numero(estado.umbral_basico, locale)} /><Cifra etiqueta={t("admin_prize_full")} valor={numero(estado.umbral_completo, locale)} /></Cifras>
      {cierrePendiente.map(x => <Bloque key={x.id}><p>{t("admin_prize_pending", { name: x.nombre })}</p><Boton variante="pri" disabled={ocupado} onClick={() => calcular(x.id)}>{t("admin_prize_calculate")}</Boton></Bloque>)}
      {estado.temporadas.length > 1 && <Segmentos etiqueta={t("admin_prize_seasons")} opciones={estado.temporadas.map(x => ({ valor: String(x.id), etiqueta: x.nombre }))} valor={String(estado.temporada_id)} alCambiar={id => cargar(Number(id))} />}
      {!elegida?.calculado ? <EstadoUI tipo="vacio">{t("admin_prize_none")}</EstadoUI> : <table className="adm-tabla"><thead><tr>{["place", "alias", "return", "rounds_column", "amount", "email"].map(k => <th key={k} className={["place", "return", "rounds_column", "amount"].includes(k) ? "der" : undefined}>{t(`admin_prize_${k}`)}</th>)}</tr></thead><tbody>{estado.filas.map(f => <tr key={f.cuenta}><td className="der">{f.puesto ?? ""}</td><td>{f.alias}</td><td className="der">{porcentajeConSigno(f.rentabilidad, locale)}</td><td className="der">{numero(f.jornadas_jugadas, locale)}</td><td className="der">{f.importe != null ? euros(f.importe, locale) : ""}</td><td>{f.email}</td></tr>)}</tbody></table>}
    </>}{dialogo}
  </Pagina>;
}

export default function PremioAdmin() {
  return (
    <AuthGate>
      <Premio />
    </AuthGate>
  );
}
