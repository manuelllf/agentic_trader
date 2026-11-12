"use client";

import Link from "next/link";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useParams, useRouter } from "next/navigation";
import { normalizeLocale } from "@/i18n/locale";
import { useConfirmar } from "@/components/Confirmar";
import { BarraPestanas, CabeceraApp, Cargando, ErrorLiga, Segmentado } from "../../_ui";
import { ListaRanking, type EntradaRanking, type FilaRanking, type ModoRanking } from "../../liga/ListaRanking";
import { expulsarDeLiga, rotarCodigoLiga, salirLiga, verLiga, type LigaDetalle, type MiembroLiga } from "@/lib/liga/api";
import { invalidar, useCache } from "@/lib/liga/cache";
import { precargarFicha } from "@/lib/liga/ficha";
import { fecha, porcentaje } from "@/lib/liga/format";
import { useSesionRequerida } from "../../_sesion/SesionContext";
import { HojaMetodo, HojaMiembros } from "../Hojas";
import "../privadas.css";

type Panel = "semana" | "tabla";

export default function PrivadaDetalle() {
  const t = useTranslations();
  const { confirmar, dialogo } = useConfirmar();
  const locale = normalizeLocale(useLocale()) ?? "es";
  const formatDate = (value: string) => fecha(value, new Date(), locale);
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { estado } = useSesionRequerida(`/privadas/${id}`);
  const { datos: liga, cargando, fallo, refrescar: cargar } = useCache<LigaDetalle | string>(
    estado === "dentro" ? `liga:${id}` : null, () => verLiga(id), 120000);

  const [panel, setPanel] = useState<Panel>("semana");
  const [aviso, setAviso] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [hojaMetodo, setHojaMetodo] = useState(false);
  const [hojaMiembros, setHojaMiembros] = useState(false);

  const detalle = typeof liga === "object" && liga ? liga : null;

  async function gestionar(accion: () => Promise<unknown>, salir = false) {
    setAviso(null);
    const r = await accion();
    if (typeof r === "string") { setAviso(r); return; }
    invalidar("mis-ligas");
    if (salir) { invalidar(`liga:${id}`); router.push("/privadas"); }
    else { setCopiado(false); cargar(); }
  }

  const copiar = async () => {
    if (!detalle?.codigo) return;
    try { await navigator.clipboard.writeText(detalle.codigo); setCopiado(true); }
    catch { setAviso(t("private_leagues_copy_manually")); }
  };

  const rotar = async () => {
    if (!(await confirmar({ titulo: t("private_leagues_change_code_confirm"), texto: t("private_leagues_change_code_note"), aceptar: t("private_leagues_generate_code") }))) return;
    void gestionar(() => rotarCodigoLiga(id));
  };

  const expulsar = async (alias: string) => {
    if (!detalle) return;
    if (!(await confirmar({ titulo: t("private_leagues_remove_confirm", { alias }), texto: t("private_leagues_remove_body", { name: detalle.nombre }), aceptar: t("private_leagues_remove"), peligro: true }))) return;
    void gestionar(() => expulsarDeLiga(id, alias));
  };

  const salir = async () => {
    if (!detalle) return;
    if (!(await confirmar({ titulo: t("private_leagues_leave_title", { name: detalle.nombre }), texto: t("private_leagues_leave_body"), aceptar: t("private_leagues_leave"), peligro: true }))) return;
    void gestionar(() => salirLiga(id), true);
  };

  // ---- Lo que se pinta: las dos vistas se construyen de los mismos miembros ----
  const miembros = detalle?.miembros ?? [];
  const mesDe = (m: MiembroLiga) => (m.rentabilidad_mes == null ? null : Number(m.rentabilidad_mes));
  const puntosDe = (m: MiembroLiga) => m.puntos ?? 0;
  const conSemana = miembros
    .filter((m): m is MiembroLiga & { estrategia: NonNullable<MiembroLiga["estrategia"]> } => !!m.estrategia && mesDe(m) !== null)
    .sort((a, b) => (mesDe(b) ?? 0) - (mesDe(a) ?? 0) || a.alias.localeCompare(b.alias));
  const conTabla = miembros
    .filter((m): m is MiembroLiga & { estrategia: NonNullable<MiembroLiga["estrategia"]> } => !!m.estrategia)
    .sort((a, b) => puntosDe(b) - puntosDe(a) || Number(b.dif_sp ?? 0) - Number(a.dif_sp ?? 0) || a.alias.localeCompare(b.alias));
  const pendientes = panel === "semana" ? miembros.filter((m) => mesDe(m) === null) : miembros.filter((m) => !m.estrategia);

  const puedeVerse = (m: MiembroLiga) => !!m.estrategia && (m.es_yo || m.estrategia.visibilidad === "publicada");
  const etiquetaMiembro = (m: MiembroLiga) => [
    m.es_yo ? t("league_equipo_tuya") : m.alias,
    !puedeVerse(m) ? t("private_leagues_private_strategy") : null,
  ].filter(Boolean).join(" · ");
  const abrir = (m: MiembroLiga) => { if (puedeVerse(m) && m.estrategia) router.push(`/ficha/${m.estrategia.id}`); };
  const precargar = (m: MiembroLiga) => () => { if (puedeVerse(m) && m.estrategia) precargarFicha(m.estrategia.id); };

  const entradasSemana: EntradaRanking[] = conSemana.map((m, i) => ({
    clave: m.alias, puesto: i + 1, nombre: m.estrategia.nombre, sub: etiquetaMiembro(m), escudo: m.estrategia.escudo,
    serie: m.serie_semana.map(Number), vs: m.diferencia_mes == null ? null : Number(m.diferencia_mes),
    rentabilidad: mesDe(m), puntos: null, tuya: m.es_yo, onAbrir: () => abrir(m), alAcercar: precargar(m),
  } satisfies FilaRanking));

  const entradasTabla: EntradaRanking[] = conTabla.map((m, i) => ({
    clave: m.alias, puesto: i + 1, movimiento: m.movimiento, nombre: m.estrategia.nombre,
    sub: [etiquetaMiembro(m), m.puntos == null ? null : t("strategies_points", { count: m.puntos })].filter(Boolean).join(" · "),
    escudo: m.estrategia.escudo, serie: m.serie_temporada.map(Number),
    vs: m.acumulado ? Number(m.acumulado.diferencia_pp) : m.dif_sp == null ? null : Number(m.dif_sp),
    rentabilidad: m.acumulado ? Number(m.acumulado.rentabilidad) : null, puntos: m.puntos, tuya: m.es_yo,
    onAbrir: () => abrir(m), alAcercar: precargar(m),
  } satisfies FilaRanking));

  const sp = detalle?.sp500_mes != null ? Number(detalle.sp500_mes) : null;
  const hayProvisionales = miembros.some((m) => m.provisional === true);

  return (
    <main className="scroll pv pv-detalle">
      <CabeceraApp anio={2026} />

      {estado === "cargando" || cargando ? <Cargando filas={4} />
        : fallo || typeof liga === "string" ? <ErrorLiga titulo={t("private_leagues_detail_error")} mensaje={typeof liga === "string" ? liga : t("private_leagues_retry_later")} accion={{ texto: t("private_leagues_retry"), onClick: cargar }} />
        : detalle && <>
          <Link href="/privadas" className="pv-atras">
            <svg width="11" height="19" viewBox="0 0 11 19" aria-hidden="true"><path d="M9.5 1.5 2 9.5l7.5 8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            {t("private_leagues_back")}
          </Link>
          <div className="pv-titulo-fila">
            <h1 className="pv-titulo">{detalle.nombre}</h1>
            <button type="button" className="pv-accion" onClick={() => setHojaMiembros(true)}>
              {detalle.es_dueno ? t("private_leagues_invite_button") : t("private_leagues_members_button")}
            </button>
          </div>
          <p className="pv-sub">
            {t("private_leagues_people", { count: detalle.n_miembros })}
            {detalle.jornada_numero ? ` · ${t("private_leagues_round", { round: detalle.jornada_numero, total: detalle.jornada_total! })}` : ""}
          </p>

          <div className="pv-seg">
            <Segmentado etiquetaGrupo={t("private_leagues_group_results")} valor={panel} onChange={setPanel}
              opciones={[{ valor: "semana", etiqueta: t("private_leagues_this_month") }, { valor: "tabla", etiqueta: t("private_leagues_standings") }]} />
          </div>

          {panel === "semana" && (
            <p className="pv-contexto">{detalle.jornada_numero
              ? t("private_leagues_round_context", { round: detalle.jornada_numero, total: detalle.jornada_total!, quotes: detalle.en_vivo ? t("private_leagues_provisional_quotes") : t("private_leagues_last_closes"), date: detalle.datos_hasta ? ` · ${formatDate(detalle.datos_hasta)}` : ` · ${t("private_leagues_waiting_prices")}` })
              : t("private_leagues_no_round_context")}</p>
          )}
          {panel === "tabla" && detalle.jornada_numero != null && hayProvisionales && (
            <p className="pv-contexto">{t("liga_clasificacion_provisional_nota", { numero: detalle.jornada_numero, total: detalle.jornada_total! })}</p>
          )}

          {(panel === "semana" ? entradasSemana.length > 0 : entradasTabla.length > 0) && (
            <ListaRanking key={panel}
              cabecera={panel === "semana"
                ? <>{t("private_leagues_this_month")} · S&amp;P <b className="num">{sp == null ? "-" : porcentaje(sp, 1, locale)}</b></>
                : t("league_lista_temporada")}
              modos={panel === "semana" ? ["vs", "rent"] : ["vs", "rent", "pts"]}
              etiquetas={{ vs: t("league_modo_vs"), rent: t("league_orden_rentabilidad"), pts: t("league_modo_puntos") } satisfies Record<ModoRanking, string>}
              entradas={panel === "semana" ? entradasSemana : entradasTabla} />
          )}

          {pendientes.length > 0 && (
            <>
              <p className="pv-cab-grupo"><span>{t("private_leagues_no_result_yet")}</span><span className="num">{pendientes.length}</span></p>
              <div className="pv-grupo-plano">
                {pendientes.map((m) => (
                  <div className="pv-fila-plana" key={m.alias}>
                    <span className="pv-txt">
                      <b>{m.alias}{m.es_yo ? ` · ${t("private_leagues_you")}` : ""}</b>
                      <small>{m.es_yo && !m.estrategia ? t("private_leagues_join_create_note") : m.estrategia ? t("private_leagues_waiting_close") : t("private_leagues_member_create_note")}</small>
                    </span>
                    {m.es_yo && !m.estrategia && <Link className="pv-enlace" href="/crear">{t("private_leagues_create_strategy")} →</Link>}
                  </div>
                ))}
              </div>
            </>
          )}

          <p className="pv-pie">
            {panel === "tabla" && <>{t("private_leagues_standings_context")}<br /></>}
            <button type="button" className="pv-enlace" onClick={() => setHojaMetodo(true)}>{t("private_leagues_rep_strategy_question")}</button>
          </p>

          {aviso && <p className="pv-error" role="alert">{aviso}</p>}

          <HojaMetodo abierta={hojaMetodo} onCerrar={() => setHojaMetodo(false)} consultado={detalle.consultado} />
          <HojaMiembros abierta={hojaMiembros} onCerrar={() => setHojaMiembros(false)} liga={detalle}
            copiado={copiado} onCopiar={copiar} onRotar={rotar} onExpulsar={expulsar} onSalir={salir} />
        </>}

      <BarraPestanas />
      {dialogo}
    </main>
  );
}
