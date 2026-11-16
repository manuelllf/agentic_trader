"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useConfirmar } from "@/components/Confirmar";
import { ApiError, get, post } from "@/lib/api";
import { dolares, fechaCorta, fechaHora, hace } from "../../_marco/formato";
import { Barras, Celda, Esqueleto, Grupo } from "../../_panel/ui";
import { CreditosHoja, PlazoHoja, RolesHoja, type Motivo, type Rol } from "./HojasFicha";
import { horasMinutos, type DiasPanel, type FichaPanel } from "./panel";
import { ICO_ATRAS } from "./pp";
import "./pp.css";

type UsuarioDetalle = {
  id: string; alias: string; roles: string[]; plan: "gratis" | "pro"; plan_hasta: string | null;
  pase_liga: boolean; pase_hasta: string | null; suspendido: boolean; creado: string; oculto: boolean; saldo: string;
};
type Movimiento = { id: number; usuario_id: string; importe: string; motivo: string; creado: string; creado_por: string | null };
type ListaMovimientos = { total: number; filas: Movimiento[] };
export type Historial = { total: number; filas: { inicio: string; ultima_actividad: string }[] };

const POR_PAGINA_VISITAS = 10;
type Abierta = null | "pro" | "pase" | "creditos" | "roles";

export function FichaUsuario({ id }: { id: string }) {
  const t = useTranslations();
  const locale = useLocale();
  const params = useSearchParams();
  const { confirmar, dialogo } = useConfirmar();
  const consulta = params.toString();
  const [u, setU] = useState<UsuarioDetalle | null>(null);
  const [ficha, setFicha] = useState<FichaPanel | null>(null);
  const [dias, setDias] = useState<DiasPanel | null>(null);
  const [movs, setMovs] = useState<ListaMovimientos | null>(null);
  const [historial, setHistorial] = useState<Historial | null>(null);
  const [desde, setDesde] = useState(0);
  const [fallo, setFallo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [hoja, setHoja] = useState<Abierta>(null);

  const errorText = useCallback((e: unknown) => (e instanceof ApiError ? e.message : t("admin_generic_error")), [t]);
  const nombreRol = (rol: string) => (["usuario", "moderador", "admin"].includes(rol) ? t(`pnl_personas_rol_${rol}`) : rol);
  const fecha = (valor: string | null) => (valor === null ? "" : fechaCorta(valor, locale));

  const cargar = useCallback(() => {
    setFallo("");
    get<UsuarioDetalle>(`/liga/admin/usuarios/${id}`).then(setU).catch(e => setFallo(errorText(e)));
    get<FichaPanel>(`/liga/admin/panel-usuarios/${id}`).then(setFicha).catch(e => setFallo(errorText(e)));
    get<DiasPanel>(`/liga/admin/panel-usuarios/${id}/dias?n=14`).then(setDias).catch(e => setFallo(errorText(e)));
    get<ListaMovimientos>(`/liga/admin/creditos?usuario_id=${id}&cuantos=20`).then(setMovs).catch(e => setFallo(errorText(e)));
  }, [id, errorText]);
  useEffect(() => { setU(null); setFicha(null); setDias(null); setMovs(null); setDesde(0); cargar(); }, [cargar]);
  useEffect(() => {
    let vigente = true;
    get<Historial>(`/liga/admin/usuarios/${id}/visitas/historial?desde=${desde}&cuantos=${POR_PAGINA_VISITAS}`)
      .then(h => { if (vigente) setHistorial(h); }).catch(e => { if (vigente) setFallo(errorText(e)); });
    return () => { vigente = false; };
  }, [id, desde, errorText]);

  const conFallo = async (accion: () => Promise<unknown>) => {
    setOcupado(true); setFallo("");
    try { await accion(); cargar(); } catch (e) { setFallo(errorText(e)); } finally { setOcupado(false); }
  };
  const aIso = (hasta: string | null) => (hasta ? new Date(hasta).toISOString() : null);

  const darPro = async (hasta: string | null) => {
    setHoja(null);
    if (!(await confirmar({ titulo: hasta ? t("pnl_personas_confirma_pro_hasta", { date: hasta }) : t("pnl_personas_confirma_pro_sin_fin"), aceptar: t("common_confirmar") }))) return;
    void conFallo(() => post(`/liga/admin/usuarios/${id}/plan`, { hasta: aIso(hasta) }));
  };
  const quitarPro = async () => {
    if (!(await confirmar({ titulo: t("pnl_personas_confirma_quitar_pro"), aceptar: t("common_confirmar"), peligro: true }))) return;
    void conFallo(() => post(`/liga/admin/usuarios/${id}/plan/quitar`, {}));
  };
  const darPase = async (hasta: string | null) => {
    setHoja(null);
    if (!(await confirmar({ titulo: hasta ? t("pnl_personas_confirma_pase_hasta", { date: hasta }) : t("pnl_personas_confirma_pase_sin_fin"), aceptar: t("common_confirmar") }))) return;
    void conFallo(() => post(`/liga/admin/usuarios/${id}/pase`, { hasta: aIso(hasta) }));
  };
  const quitarPase = async () => {
    if (!(await confirmar({ titulo: t("pnl_personas_confirma_quitar_pase"), aceptar: t("common_confirmar"), peligro: true }))) return;
    void conFallo(() => post(`/liga/admin/usuarios/${id}/pase/quitar`, {}));
  };
  const suspender = async () => {
    if (!u) return;
    const nuevo = !u.suspendido;
    if (!(await confirmar({ titulo: t(nuevo ? "pnl_personas_confirma_suspender" : "pnl_personas_confirma_reactivar"), aceptar: t("common_confirmar"), peligro: nuevo }))) return;
    void conFallo(() => post(`/liga/admin/usuarios/${id}/suspender`, { suspendido: nuevo }));
  };
  const darCreditos = async (importe: string, motivo: Motivo) => {
    setHoja(null);
    const razon = t(motivo === "regalo" ? "pnl_personas_creditos_regalo" : "pnl_personas_creditos_ajuste");
    if (!(await confirmar({ titulo: t("pnl_personas_confirma_creditos", { amount: importe, reason: razon }), aceptar: t("common_confirmar") }))) return;
    void conFallo(() => post("/liga/admin/creditos", { usuario_id: id, importe, motivo, idempotencia: crypto.randomUUID() }));
  };
  const guardarRoles = async (cambios: { rol: Rol; conceder: boolean }[]) => {
    setHoja(null);
    setOcupado(true); setFallo("");
    try {
      for (const { rol, conceder } of cambios) {
        const ok = await confirmar({ titulo: t(conceder ? "pnl_personas_confirma_rol_dar" : "pnl_personas_confirma_rol_quitar", { role: nombreRol(rol) }), aceptar: t("common_confirmar"), peligro: !conceder });
        if (ok) await post(`/liga/admin/usuarios/${id}/rol`, { rol, conceder });
      }
    } catch (e) { setFallo(errorText(e)); } finally { setOcupado(false); cargar(); }
  };

  const volver = (
    <Link href={"/admin/liga/usuarios" + (consulta ? `?${consulta}` : "")} className="pp-volver">{ICO_ATRAS}{t("pnl_personas_volver")}</Link>
  );
  if (!u || !ficha || !dias) {
    return (
      <div className="pnl-llega pp">
        {volver}
        {fallo ? <p className="pnl-pie-grupo" role="alert">{fallo}</p> : <Esqueleto filas={6} etiqueta={t("admin_pnl_cargando")} />}
        {dialogo}
      </div>
    );
  }

  const tiempo = horasMinutos(ficha.actividad.tiempo_30d_seg);
  const totalDias = dias.dias.reduce((s, d) => s + d.visitas, 0);
  const dinero = (v: string) => dolares(v, locale);
  const llamadas = (n: number, v: string) => `${t("pnl_personas_ia_llamadas", { count: n })} · ${dinero(v)}`;
  const { ia, liga, actividad } = ficha;
  const planTexto = u.plan === "pro" ? (u.plan_hasta ? t("pnl_personas_plan_pro_hasta", { date: fecha(u.plan_hasta) }) : t("pnl_personas_plan_pro_sin_fin")) : t("pnl_personas_plan_gratis");
  const paseTexto = u.pase_liga ? (u.pase_hasta ? t("pnl_personas_pase_hasta", { date: fecha(u.pase_hasta) }) : t("pnl_personas_pase_sin_fin")) : t("pnl_personas_pase_ninguno");
  const hora = new Intl.DateTimeFormat(locale, { timeStyle: "short" });

  return (
    <div className="pnl-llega pp pp-ficha">
      {volver}
      <h2 className="pnl-titular">{u.alias}</h2>
      <div className="pp-tira">
        {u.plan === "pro" && <span className="pp-etq">{t("pnl_personas_etq_pro")}</span>}
        {u.roles.map(r => <span key={r} className="pp-etq">{nombreRol(r)}</span>)}
        {u.suspendido && <span className="pp-etq">{t("pnl_personas_etq_suspendido")}</span>}
      </div>
      {fallo && <p className="pnl-pie-grupo" role="alert">{fallo}</p>}

      <Grupo cabecera={t("pnl_personas_perfil_cab")}>
        <Celda titulo={t("pnl_personas_correo")} subtitulo={ficha.email ?? t("pnl_personas_sin_correo")} />
        <Celda titulo={t("pnl_personas_alta")} valor={fecha(u.creado)} />
        <Celda titulo={t("pnl_personas_saldo")} valor={dinero(u.saldo)} />
        <Celda titulo={t("pnl_personas_edad")} subtitulo={ficha.edad === null ? t("pnl_personas_sin_edad") : t("pnl_personas_edad_valor", { age: ficha.edad, date: fecha(ficha.edad_declarada_en) })} />
        <Celda titulo={t("pnl_personas_terminos")} subtitulo={ficha.terminos.aceptado ? t("pnl_personas_terminos_valor", { version: ficha.terminos.version, date: fecha(ficha.terminos.aceptado_en) }) : t("pnl_personas_terminos_falta", { version: ficha.terminos.version })} />
        <Celda titulo={t("pnl_personas_baja")} valor={ficha.baja_solicitada === null ? t("pnl_personas_no") : t("pnl_personas_baja_valor", { date: fecha(ficha.baja_solicitada) })} />
        <Celda titulo={t("pnl_personas_oculto")} valor={t(ficha.oculto ? "pnl_personas_si" : "pnl_personas_no")} />
        <Celda titulo={t("pnl_personas_estado")} valor={t(u.suspendido ? "pnl_personas_estado_suspendida" : "pnl_personas_estado_activa")} />
      </Grupo>

      <Grupo cabecera={t("pnl_personas_actividad_cab")}>
        <Celda titulo={t("pnl_personas_visitas")} valor={actividad.visitas_total} />
        <Celda titulo={t("pnl_personas_ultima_visita")} valor={actividad.ultima_visita ? hace(actividad.ultima_visita, locale) : t("pnl_personas_sin_visitas")} />
        <Celda titulo={t("pnl_personas_ultima_actividad")} valor={actividad.ultima_actividad ? hace(actividad.ultima_actividad, locale) : t("pnl_personas_sin_actividad_larga")} />
        <Celda titulo={t("pnl_personas_tiempo")} valor={t("pnl_personas_tiempo_valor", { hours: tiempo.horas, minutes: tiempo.minutos })} />
      </Grupo>
      <h2 className="pnl-cab-grupo">{t("pnl_personas_grafico_cab")}</h2>
      <Barras valores={dias.dias.map(d => d.visitas)} etiquetas={[t("pnl_personas_hace_14"), t("pnl_personas_hoy")]}
        etiquetaAria={t("pnl_personas_grafico_aria", { total: totalDias })} />
      {historial === null ? null : (
        <Grupo cabecera={t("pnl_personas_recientes_cab")}>
          {historial.filas.length === 0
            ? <Celda titulo={t("pnl_personas_historial_vacio")} />
            : historial.filas.map(v => <Celda key={v.inicio} titulo={t("pnl_personas_visita_hasta", { start: fechaHora(v.inicio, locale), end: hora.format(new Date(v.ultima_actividad)) })} />)}
        </Grupo>
      )}
      {historial !== null && historial.total > 0 && (
        <div className="pp-pager">
          <button type="button" disabled={desde === 0} onClick={() => setDesde(desde - POR_PAGINA_VISITAS)}>{t("admin_previous")}</button>
          <span>{t("pnl_personas_paginacion", { from: desde + 1, to: Math.min(desde + POR_PAGINA_VISITAS, historial.total), total: historial.total })}</span>
          <button type="button" disabled={desde + POR_PAGINA_VISITAS >= historial.total} onClick={() => setDesde(desde + POR_PAGINA_VISITAS)}>{t("admin_next")}</button>
        </div>
      )}

      <Grupo cabecera={t("pnl_personas_ia_cab")}>
        <Celda titulo={t("pnl_personas_ia_conversor")} valor={llamadas(ia.mes.conversor_llamadas, ia.mes.conversor_usd)} />
        <Celda titulo={t("pnl_personas_ia_pregunta")} valor={llamadas(ia.mes.pregunta_llamadas, ia.mes.pregunta_usd)} />
        <Celda titulo={t("pnl_personas_ia_lectura")} valor={llamadas(ia.mes.lectura_llamadas, ia.mes.lectura_usd)} />
        <Celda titulo={t("pnl_personas_ia_llamadas", { count: ia.mes.llamadas })} valor={dinero(ia.mes.total_usd)} />
        <Celda titulo={t("pnl_personas_ia_cache")} valor={ia.mes.cache} />
        <Celda titulo={t("pnl_personas_ia_historico")} valor={dinero(ia.historico_usd)} />
      </Grupo>

      <Grupo cabecera={t("pnl_personas_liga_cab")}>
        <Celda titulo={t("pnl_personas_liga_estrategias")} valor={t("pnl_personas_liga_jugando", { total: liga.estrategias, playing: liga.estrategias_jugando })} />
        <Celda titulo={t("pnl_personas_liga_inscripciones")} valor={liga.inscripciones} />
        <Celda titulo={t("pnl_personas_liga_privadas")} valor={t("pnl_personas_liga_privadas_valor", { owned: liga.ligas_propias, member: liga.ligas_miembro })} />
        <Celda titulo={t("pnl_personas_reportes")} valor={t("pnl_personas_reportes_valor", { made: liga.reportes_hechos, received: liga.reportes_recibidos })} />
      </Grupo>

      <Grupo cabecera={t("pnl_personas_acciones_cab")}>
        <Celda titulo={t("pnl_personas_plan")} subtitulo={planTexto} />
        {u.plan !== "pro"
          ? <Celda titulo={t("pnl_personas_dar_pro")} tono="accion" deshabilitada={ocupado} onClick={() => setHoja("pro")} />
          : <Celda titulo={t("pnl_personas_quitar_pro")} tono="peligro" deshabilitada={ocupado} onClick={quitarPro} />}
        <Celda titulo={t("pnl_personas_pase")} subtitulo={paseTexto} />
        {!u.pase_liga
          ? <Celda titulo={t("pnl_personas_dar_pase")} tono="accion" deshabilitada={ocupado} onClick={() => setHoja("pase")} />
          : <Celda titulo={t("pnl_personas_quitar_pase")} tono="peligro" deshabilitada={ocupado} onClick={quitarPase} />}
        <Celda titulo={t("pnl_personas_dar_creditos")} tono="accion" deshabilitada={ocupado} onClick={() => setHoja("creditos")} />
        <Celda titulo={t("pnl_personas_cambiar_roles")} valor={u.roles.map(nombreRol).join(", ")} deshabilitada={ocupado} onClick={() => setHoja("roles")} />
      </Grupo>

      <Grupo cabecera={t("pnl_personas_movimientos_cab")}>
        {!movs || movs.filas.length === 0
          ? <Celda titulo={t("pnl_personas_movimientos_vacio")} />
          : movs.filas.map(m => (
            <Celda key={m.id} titulo={m.motivo === "regalo" ? t("pnl_personas_creditos_regalo") : m.motivo === "ajuste" ? t("pnl_personas_creditos_ajuste") : m.motivo}
              subtitulo={fechaCorta(m.creado, locale)} valor={dinero(m.importe)} />
          ))}
      </Grupo>

      <Grupo>
        <Celda titulo={t(u.suspendido ? "pnl_personas_reactivar" : "pnl_personas_suspender")} tono={u.suspendido ? "accion" : "peligro"} deshabilitada={ocupado} onClick={suspender} />
      </Grupo>

      {hoja === "pro" && <PlazoHoja titulo={t("pnl_personas_dar_pro")} accion={t("pnl_personas_dar_pro")} onAplicar={darPro} onCerrar={() => setHoja(null)} />}
      {hoja === "pase" && <PlazoHoja titulo={t("pnl_personas_dar_pase")} accion={t("pnl_personas_dar_pase")} onAplicar={darPase} onCerrar={() => setHoja(null)} />}
      {hoja === "creditos" && <CreditosHoja onDar={darCreditos} onCerrar={() => setHoja(null)} />}
      {hoja === "roles" && <RolesHoja actuales={u.roles} onGuardar={guardarRoles} onCerrar={() => setHoja(null)} />}
      {dialogo}
    </div>
  );
}
