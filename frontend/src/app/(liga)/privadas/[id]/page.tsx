"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { normalizeLocale } from "@/i18n/locale";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { InfoTip } from "@/components/InfoTip";
import { BarraPestanas, Boton, Cargando, Escudo, ErrorLiga, Segmentado } from "../../_ui";
import { expulsarDeLiga, rotarCodigoLiga, salirLiga, verLiga, type LigaDetalle } from "@/lib/liga/api";
import { invalidar, useCache } from "@/lib/liga/cache";
import { useSesionRequerida } from "../../_sesion/SesionContext";
import { claseSigno, fecha, porcentaje } from "@/lib/liga/format";
import "../privadas.css";

export default function PrivadaDetalle() {
  const t = useTranslations();
  const locale = normalizeLocale(useLocale()) ?? "es";
  const date = (value: string) => fecha(value, new Date(), locale);
  const percent = (value: number) => porcentaje(value, 1, locale);
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { estado } = useSesionRequerida(`/privadas/${id}`);
  const { datos: liga, cargando, fallo, refrescar: cargar } = useCache<LigaDetalle | string>(
    estado === "dentro" ? `liga:${id}` : null, () => verLiga(id), 120000);
  const [vista, setVista] = useState("mes");
  const [ocupada, setOcupada] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  async function gestionar(accion: () => Promise<unknown>, salir = false) {
    setOcupada(true); setAviso(null);
    try {
      const r = await accion();
      if (typeof r === "string") { setAviso(r); return; }
      invalidar("mis-ligas");
      if (salir) { invalidar(`liga:${id}`); router.push("/privadas"); }
      else { setCopiado(false); cargar(); }
    } finally { setOcupada(false); }
  }

  const lista = typeof liga === "object" && liga ? [...liga.miembros] : [];
  if (vista === "mes") lista.sort((a, b) => (a.rentabilidad_mes == null ? 1 : 0) - (b.rentabilidad_mes == null ? 1 : 0)
    || Number(b.rentabilidad_mes ?? 0) - Number(a.rentabilidad_mes ?? 0) || a.alias.localeCompare(b.alias));
  const activos = lista.filter(m => m.rentabilidad_mes != null).length;

  return <main className="scroll privadas">
    <Link href="/privadas" className="back">← {t("private_leagues_back")}</Link>
    {estado === "cargando" || cargando ? <Cargando filas={4} />
      : fallo || typeof liga === "string" ? <ErrorLiga titulo={t("private_leagues_detail_error")} mensaje={typeof liga === "string" ? liga : t("private_leagues_retry_later")} accion={{ texto: t("private_leagues_retry"), onClick: cargar }} />
      : liga && <>
        <header className="priv-cabecera">
          <p className="priv-eyebrow">{t("private_leagues_detail_eyebrow", { role: liga.es_dueno ? t("private_leagues_owner") : t("private_leagues_your_group") })}</p>
          <h1 className="h1">{liga.nombre}</h1>
          <p className="meta">{t("private_leagues_detail_intro")}</p>
          <dl className="priv-resumen">
            <div><dt>{t("private_leagues_participants_label")}</dt><dd>{liga.n_miembros}<small> / {liga.cupo}</small></dd></div>
            <div><dt>{t("private_leagues_with_result")}</dt><dd>{activos}</dd></div>
            <div><dt>{t("private_leagues_sp_month")}</dt><dd className={liga.sp500_mes == null ? "" : claseSigno(liga.sp500_mes)}>{liga.sp500_mes == null ? "—" : percent(liga.sp500_mes)}</dd></div>
          </dl>
        </header>
        <div className="priv-contenido">
          <section className="priv-clasificacion" aria-label={t("private_leagues_teams_results")}>
            <Segmentado etiquetaGrupo={t("private_leagues_group_results")} valor={vista} onChange={setVista}
              opciones={[{ valor: "mes", etiqueta: t("private_leagues_this_month") }, { valor: "oficial", etiqueta: t("private_leagues_standings") }]} />
            <p className="fine priv-contexto">{vista === "mes"
              ? liga.jornada_numero ? t("private_leagues_round_context", { round: liga.jornada_numero, quotes: liga.en_vivo ? t("private_leagues_provisional_quotes") : t("private_leagues_last_closes"), date: liga.datos_hasta ? ` · ${date(liga.datos_hasta)}` : ` · ${t("private_leagues_waiting_prices")}` })
                : t("private_leagues_no_round_context")
              : t("private_leagues_standings_context")}</p>
            <details className="priv-metodo"><summary>{t("private_leagues_rep_strategy_question")}</summary>
              <p>{t("private_leagues_rep_strategy_answer")}</p>
              <p>{t("private_leagues_cumulative_note")}</p>
            </details>
            {vista === "mes" && liga.consultado && <p className="fine">{t("private_leagues_market_checked", { time: new Date(liga.consultado).toLocaleTimeString(locale, {hour:"2-digit",minute:"2-digit"}) })}</p>}
            <div className="priv-equipos">
              {lista.map((m, i) => {
                const e = m.estrategia;
                const conResultado = vista === "mes" ? m.rentabilidad_mes != null : m.puntos != null;
                return <article className={`priv-equipo${m.es_yo ? " propia" : ""}`} key={m.alias}>
                  <button type="button" className="priv-equipo-cab priv-equipo-abrir" disabled={!e}
                    onClick={() => e && router.push(`/ficha/${e.id}`)}>
                    <span className="priv-puesto" aria-label={conResultado ? t("private_leagues_position", { position: i + 1 }) : t("private_leagues_unranked")}>{conResultado ? String(i + 1).padStart(2, "0") : "—"}</span>
                    {e && <Escudo valor={e.escudo} etiqueta={t("private_leagues_strategy_crest", { name: e.nombre })} tamano={38} />}
                    <span className="priv-identidad"><b>{e?.nombre ?? m.alias}</b><small>{e ? m.alias : t("private_leagues_no_formed_strategy")}{m.es_yo ? ` · ${t("private_leagues_you")}` : ""}</small></span>
                    <span className="priv-resultado">{vista === "mes" ? <b className={m.rentabilidad_mes == null ? "" : claseSigno(m.rentabilidad_mes)}>{m.rentabilidad_mes == null ? "—" : percent(m.rentabilidad_mes)}</b> : <b>{m.puntos ?? "—"}</b>}<small>{vista === "mes" ? t("private_leagues_this_month") : t("private_leagues_points")}</small></span>
                    {e && <span aria-hidden="true">→</span>}
                  </button>
                  {!e && <p className="fine">{m.es_yo ? t("private_leagues_join_create_note") : t("private_leagues_member_create_note")}{m.es_yo && <Link className="link" href="/crear"> {t("private_leagues_create_strategy")} →</Link>}</p>}
                </article>;
              })}
            </div>
          </section>
          <aside className="priv-gestion">
            {liga.es_dueno && liga.codigo && <section className="priv-panel">
              <h2>{t("private_leagues_invite_group")}</h2><p>{t("private_leagues_share_code_note")}</p>
              <code className="priv-codigo">{liga.codigo}</code>
              <Boton ancho="completo" onClick={async () => { try { await navigator.clipboard.writeText(liga.codigo!); setCopiado(true); } catch { setAviso(t("private_leagues_copy_manually")); } }}>{copiado ? t("private_leagues_code_copied") : t("private_leagues_copy_code")}</Boton>
              <details className="priv-metodo"><summary>{t("private_leagues_change_code")}</summary><p>{t("private_leagues_change_code_note")}</p>
                <Boton disabled={ocupada} onClick={() => { if (window.confirm(t("private_leagues_change_code_confirm"))) void gestionar(() => rotarCodigoLiga(id)); }}>{t("private_leagues_generate_code")}</Boton>
              </details>
            </section>}
            <section className="priv-panel"><h2>{t("private_leagues_how_compare")} <InfoTip text={t("private_leagues_compare_tip")} /></h2>
              <p>{t("private_leagues_compare_note")}</p>
              <Link className="link" href="/como-funciona">{t("private_leagues_view_rules")} →</Link>
            </section>
            <details className="priv-panel"><summary>{t("private_leagues_manage_members")}</summary>
              {liga.miembros.map(m => <div className="priv-miembro" key={m.alias}><span>{m.alias}{m.es_yo ? ` · ${t("private_leagues_you")}` : ""}<small>{t("private_leagues_member_since", { date: date(m.unido.slice(0, 10)) })}</small></span>
                {liga.es_dueno && !m.es_yo && <Boton variante="discreto" disabled={ocupada} onClick={() => { if (window.confirm(t("private_leagues_remove_confirm", { alias: m.alias }))) void gestionar(() => expulsarDeLiga(id, m.alias)); }}>{t("private_leagues_remove")}</Boton>}</div>)}
              {!liga.es_dueno && <Boton disabled={ocupada} onClick={() => { if (window.confirm(t("private_leagues_leave_confirm"))) void gestionar(() => salirLiga(id), true); }}>{t("private_leagues_leave")}</Boton>}
            </details>
          </aside>
        </div>
      </>}
    {aviso && <p className="aviso" role="alert">{aviso}</p>}
    <BarraPestanas />
  </main>;
}
