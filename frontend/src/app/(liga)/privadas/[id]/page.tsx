"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { normalizeLocale } from "@/i18n/locale";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  BarraPestanas, Boton, Cargando, Clasificacion as TablaClasificacion, ErrorLiga, FilaEquipo,
  FilaJornada, Segmentado,
} from "../../_ui";
import {
  expulsarDeLiga, rotarCodigoLiga, salirLiga, verLiga, type LigaDetalle, type MiembroLiga,
} from "@/lib/liga/api";
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

  const miembros = typeof liga === "object" && liga ? liga.miembros : [];
  const mes = (m: MiembroLiga) => (m.rentabilidad_mes == null ? null : Number(m.rentabilidad_mes));
  const conResultado = [...miembros.filter((m) => mes(m) !== null)]
    .sort((a, b) => (mes(b) ?? 0) - (mes(a) ?? 0) || a.alias.localeCompare(b.alias));
  const clasificados = miembros.filter((m) => m.estrategia);
  const pendientes = vista === "mes"
    ? miembros.filter((m) => mes(m) === null) : miembros.filter((m) => !m.estrategia);
  const mejor = conResultado[0] ? mes(conResultado[0]) : null;
  const sp = liga && typeof liga === "object" && liga.sp500_mes != null ? Number(liga.sp500_mes) : null;

  const etiqueta = (m: MiembroLiga, abrible: boolean) => [
    m.alias + (m.es_yo ? ` · ${t("private_leagues_you")}` : ""),
    m.estrategia && !abrible ? t("private_leagues_private_strategy") : null,
  ].filter(Boolean).join(" · ");
  const abrir = (m: MiembroLiga) => !!m.estrategia && (m.es_yo || m.estrategia.visibilidad === "publicada");
  const ir = (m: MiembroLiga) => () => { if (m.estrategia) router.push(`/ficha/${m.estrategia.id}`); };

  return <main className="scroll privadas">
    <Link href="/privadas" className="back">← {t("private_leagues_back")}</Link>
    {estado === "cargando" || cargando ? <Cargando filas={4} />
      : fallo || typeof liga === "string" ? <ErrorLiga titulo={t("private_leagues_detail_error")} mensaje={typeof liga === "string" ? liga : t("private_leagues_retry_later")} accion={{ texto: t("private_leagues_retry"), onClick: cargar }} />
      : liga && <>
        <header className="priv-cabecera">
          <p className="priv-eyebrow">{t("private_leagues_detail_eyebrow", { role: liga.es_dueno ? t("private_leagues_owner") : t("private_leagues_your_group") })}</p>
          <h1 className="h1">{liga.nombre}</h1>
          <p className="meta">
            {t("private_leagues_people", { count: liga.n_miembros })}
            {liga.jornada_numero ? ` · ${t("private_leagues_round", { round: liga.jornada_numero })}` : ""}
          </p>
          <dl className="priv-resumen">
            <div><dt>{t("private_leagues_sp_month")}</dt><dd className={sp == null ? "" : claseSigno(sp)}>{sp == null ? "—" : percent(sp)}</dd></div>
            <div><dt>{t("private_leagues_best_group")}</dt><dd className={mejor == null ? "" : claseSigno(mejor)}>{mejor == null ? "—" : percent(mejor)}</dd></div>
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
            {vista === "mes" ? (
              <div className="priv-filas">
                {conResultado.map((m, i) => m.estrategia && (
                  <FilaJornada key={m.alias} puesto={i + 1} nombre={m.estrategia.nombre} escudo={m.estrategia.escudo}
                    etiqueta={etiqueta(m, abrir(m))} rentabilidad={mes(m) ?? 0}
                    diferencia={m.diferencia_mes == null ? null : Number(m.diferencia_mes)}
                    propia={m.es_yo} onAbrir={abrir(m) ? ir(m) : undefined} />
                ))}
              </div>
            ) : clasificados.length > 0 && (
              <TablaClasificacion>
                {clasificados.map((m, i) => m.estrategia && (
                  <FilaEquipo key={m.alias} puesto={i + 1} nombre={m.estrategia.nombre} escudo={m.estrategia.escudo}
                    etiqueta={etiqueta(m, abrir(m))} vsIndice={Number(m.dif_sp ?? 0)} puntos={m.puntos ?? 0}
                    acumulado={m.acumulado} movimiento={m.movimiento} tipo={m.es_yo ? "mia" : "normal"}
                    abrible={abrir(m)} onClick={ir(m)} />
                ))}
              </TablaClasificacion>
            )}

            {pendientes.length > 0 && (
              <div className="priv-pendientes">
                <p className="grp">{t("private_leagues_no_result_yet")} <small>{pendientes.length}</small></p>
                {pendientes.map((m) => (
                  <div className="priv-miembro" key={m.alias}>
                    <span>{m.alias}{m.es_yo ? ` · ${t("private_leagues_you")}` : ""}
                      <small>{m.estrategia ? t("private_leagues_waiting_close")
                        : m.es_yo ? t("private_leagues_join_create_note") : t("private_leagues_member_create_note")}</small></span>
                    {m.es_yo && !m.estrategia && <Link className="link" href="/crear">{t("private_leagues_create_strategy")} →</Link>}
                  </div>
                ))}
              </div>
            )}

            <details className="priv-metodo"><summary>{t("private_leagues_rep_strategy_question")}</summary>
              <p>{t("private_leagues_rep_strategy_answer")}</p>
              <p>{t("private_leagues_cumulative_note")}</p>
              {liga.consultado && <p>{t("private_leagues_market_checked", { time: new Date(liga.consultado).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) })}</p>}
              <p>{t("private_leagues_compare_note")} <Link className="link" href="/como-funciona">{t("private_leagues_view_rules")} →</Link></p>
            </details>
          </section>

          <aside className="priv-gestion">
            <details className="priv-panel"><summary>{t("private_leagues_invite_and_members")}</summary>
              {liga.es_dueno && liga.codigo && <div className="priv-invitar">
                <p>{t("private_leagues_share_code_note")}</p>
                <code className="priv-codigo">{liga.codigo}</code>
                <Boton ancho="completo" onClick={async () => { try { await navigator.clipboard.writeText(liga.codigo!); setCopiado(true); } catch { setAviso(t("private_leagues_copy_manually")); } }}>{copiado ? t("private_leagues_code_copied") : t("private_leagues_copy_code")}</Boton>
                <details className="priv-metodo"><summary>{t("private_leagues_change_code")}</summary><p>{t("private_leagues_change_code_note")}</p>
                  <Boton disabled={ocupada} onClick={() => { if (window.confirm(t("private_leagues_change_code_confirm"))) void gestionar(() => rotarCodigoLiga(id)); }}>{t("private_leagues_generate_code")}</Boton>
                </details>
              </div>}
              {liga.miembros.map((m) => <div className="priv-miembro" key={m.alias}><span>{m.alias}{m.es_yo ? ` · ${t("private_leagues_you")}` : ""}<small>{t("private_leagues_member_since", { date: date(m.unido.slice(0, 10)) })}</small></span>
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
