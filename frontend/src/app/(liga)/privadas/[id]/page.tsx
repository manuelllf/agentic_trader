"use client";

import Link from "next/link";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useParams, useRouter } from "next/navigation";
import { normalizeLocale } from "@/i18n/locale";
import { useConfirmar } from "@/components/Confirmar";
import { BarraPestanas, CabeceraApp, Cargando, ErrorLiga } from "../../_ui";
import { ListaRanking, type EntradaRanking, type FilaRanking, type ModoRanking } from "../../liga/ListaRanking";
import { SegmentoLiga } from "../../liga/SegmentoLiga";
import { expulsarDeLiga, rotarCodigoLiga, salirLiga, verLiga, type LigaDetalle, type MiembroLiga } from "@/lib/liga/api";
import { invalidar, useCache } from "@/lib/liga/cache";
import { precargarFicha } from "@/lib/liga/ficha";
import { fecha, porcentaje } from "@/lib/liga/format";
import { useSesionRequerida } from "../../_sesion/SesionContext";
import { HojaInvitar, HojaMetodo, HojaMiembros } from "../Hojas";
import { irConTransicion } from "../transicion";
import "../privadas.css";

type Panel = "semana" | "tabla";

function Chevron() {
  return (
    <svg className="pv-chev" viewBox="0 0 8 14" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m1.5 1.5 5 5.5-5 5.5" />
    </svg>
  );
}

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
  const [hojaInvitar, setHojaInvitar] = useState(false);
  const [hojaMiembros, setHojaMiembros] = useState(false);

  const detalle = typeof liga === "object" && liga ? liga : null;

  async function gestionar(accion: () => Promise<unknown>, salir = false) {
    setAviso(null);
    const r = await accion();
    if (typeof r === "string") { setAviso(r); return; }
    invalidar("mis-ligas");
    if (salir) { invalidar(`liga:${id}`); irConTransicion("/privadas", "vuelve", router); }
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

  // Pie: qué cifras son provisionales y cuándo se cerró la última.
  let pie: string | null = null;
  if (detalle) {
    if (panel === "semana") {
      pie = detalle.jornada_numero
        ? `${detalle.en_vivo ? t("private_leagues_provisional_quotes") : t("private_leagues_last_closes")} · ${detalle.datos_hasta ? formatDate(detalle.datos_hasta) : t("private_leagues_waiting_prices")}`
        : t("private_leagues_no_round_context");
    } else if (detalle.jornada_numero != null && hayProvisionales) {
      pie = t("liga_clasificacion_provisional_nota", { numero: detalle.jornada_numero, total: detalle.jornada_total! });
    }
  }

  return (
    <main className="scroll lv-pagina pv pv-detalle">
      <CabeceraApp titulo={detalle?.nombre ?? t("private_leagues_title")}
        izquierda={
          <button type="button" className="pv-volver" aria-label={t("private_leagues_back")}
            onClick={() => irConTransicion("/privadas", "vuelve", router)}>
            <svg width="13" height="22" viewBox="0 0 13 22" fill="none" stroke="currentColor" strokeWidth="2.6"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M11 2 2 11l9 9" />
            </svg>
          </button>
        } />

      {estado === "cargando" || cargando ? <Cargando filas={4} />
        : fallo || typeof liga === "string" ? <ErrorLiga titulo={t("private_leagues_detail_error")} mensaje={typeof liga === "string" ? liga : t("private_leagues_retry_later")} accion={{ texto: t("private_leagues_retry"), onClick: cargar }} />
        : detalle && <>
          <SegmentoLiga etiquetaGrupo={t("private_leagues_group_results")} valor={panel} onChange={setPanel}
            opciones={[{ valor: "semana", etiqueta: t("private_leagues_this_month") }, { valor: "tabla", etiqueta: t("private_leagues_standings") }]} />

          {(panel === "semana" ? entradasSemana.length > 0 : entradasTabla.length > 0) && (
            <ListaRanking key={panel}
              cabecera={panel === "semana"
                ? (detalle.jornada_numero
                  ? <>{t("private_leagues_round", { round: detalle.jornada_numero, total: detalle.jornada_total! })} · S&amp;P <b className="num">{sp == null ? "-" : porcentaje(sp, 1, locale)}</b></>
                  : t("private_leagues_this_month"))
                : t("league_lista_temporada")}
              modos={panel === "semana" ? ["vs", "rent"] : ["vs", "rent", "pts"]}
              etiquetas={{ vs: t("league_modo_vs"), rent: t("league_orden_rentabilidad"), pts: t("league_modo_puntos") } satisfies Record<ModoRanking, string>}
              entradas={panel === "semana" ? entradasSemana : entradasTabla} />
          )}

          {pendientes.length > 0 && (
            <>
              <p className="lv-lista-cab"><span>{t("private_leagues_no_result_yet")}</span><span className="num">{pendientes.length}</span></p>
              <ul className="lv-lista">
                {pendientes.map((m) => (
                  <li className="lv-fila pv-pendiente" key={m.alias}>
                    <span className="lv-nombre">
                      <b>{m.alias}{m.es_yo ? ` · ${t("private_leagues_you")}` : ""}</b>
                      <small>{m.es_yo && !m.estrategia ? t("private_leagues_join_create_note") : m.estrategia ? t("private_leagues_waiting_close") : t("private_leagues_member_create_note")}</small>
                      {m.es_yo && !m.estrategia && <Link className="pv-enlace-fila" href="/crear">{t("private_leagues_create_strategy")}</Link>}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className="pv-grupo">
            {detalle.es_dueno && (
              <button type="button" className="pv-celda accion" onClick={() => setHojaInvitar(true)}>
                <span>{t("private_leagues_invite_button")}</span>
              </button>
            )}
            <button type="button" className="pv-celda" onClick={() => setHojaMiembros(true)}>
              <span>{t("private_leagues_members_button")}</span>
              <span className="valor num">{detalle.n_miembros}</span>
              <Chevron />
            </button>
            {!detalle.es_dueno && (
              <button type="button" className="pv-celda peligro" onClick={salir}>
                <span>{t("private_leagues_leave")}</span>
              </button>
            )}
          </div>

          <p className="lv-pie">
            {pie && <>{pie}<br /></>}
            <button type="button" className="pv-pie-enlace" onClick={() => setHojaMetodo(true)}>{t("private_leagues_rep_strategy_question")}</button>
          </p>

          {aviso && <p className="pv-error" role="alert">{aviso}</p>}

          <HojaMetodo abierta={hojaMetodo} onCerrar={() => setHojaMetodo(false)} consultado={detalle.consultado} />
          {detalle.es_dueno && (
            <HojaInvitar abierta={hojaInvitar} onCerrar={() => { setHojaInvitar(false); setAviso(null); }} liga={detalle}
              copiado={copiado} aviso={aviso} onCopiar={copiar} onRotar={rotar} />
          )}
          <HojaMiembros abierta={hojaMiembros} onCerrar={() => { setHojaMiembros(false); setAviso(null); }} liga={detalle}
            aviso={aviso} onExpulsar={expulsar} />
        </>}

      <BarraPestanas />
      {dialogo}
    </main>
  );
}
