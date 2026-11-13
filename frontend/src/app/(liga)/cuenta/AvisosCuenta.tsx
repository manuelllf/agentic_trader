"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { cambiarResumenCorreo, estadoAvisos, guardarAvisosCorreo, probarAvisoCuenta } from "@/lib/liga/avisos";
import { useSesion } from "../_sesion/SesionContext";
import { Interruptor } from "./Interruptor";
import { BarraCuenta, CabGrupo, CuerpoCuenta, Grupo, Pie } from "./marco";
import { usePushDispositivo } from "./usePushDispositivo";

const CORREO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Avisos de la cuenta: push en este dispositivo, correo y a qué dirección. La dirección se guarda al
 *  salir del campo; vacía o igual a la de la cuenta, queda como «la de la cuenta». */
export function AvisosCuenta() {
  const t = useTranslations();
  const { yo, email, refrescarYo } = useSesion();
  const push = usePushDispositivo();
  const cuenta = email ?? "";
  const [correoActivo, setCorreoActivo] = useState(Boolean(yo?.avisos_correo));
  const [direccion, setDireccion] = useState(yo?.correo_avisos ?? cuenta);
  const guardada = useRef(direccion);
  const [guardado, setGuardado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [resumenActivo, setResumenActivo] = useState(true);
  const [resumenOcupado, setResumenOcupado] = useState(true);
  const [resumenError, setResumenError] = useState(false);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const estado = await estadoAvisos();
        if (!vivo) return;
        if (typeof estado === "string") setResumenError(true);
        else setResumenActivo(estado.resumen_correo ?? true);
      } catch {
        if (vivo) setResumenError(true);
      } finally {
        if (vivo) setResumenOcupado(false);
      }
    })();
    return () => { vivo = false; };
  }, []);

  async function cambiarResumen(activo: boolean) {
    if (resumenOcupado) return;
    const anterior = resumenActivo;
    setResumenActivo(activo);
    setResumenOcupado(true);
    setResumenError(false);
    try {
      const r = await cambiarResumenCorreo(activo);
      if (typeof r === "string") throw new Error(r);
    } catch {
      setResumenActivo(anterior);
      setResumenError(true);
    } finally {
      setResumenOcupado(false);
    }
  }

  const [probandoAviso, setProbandoAviso] = useState(false);
  const [avisoMsg, setAvisoMsg] = useState("");
  async function probarAviso() {
    if (probandoAviso) return;
    setProbandoAviso(true);
    setAvisoMsg("");
    try {
      const r = await probarAvisoCuenta();
      setAvisoMsg(typeof r === "string" ? t("avisos_probar_error")
        : t("avisos_probar_resultado", { ok: r.ok, total: r.dispositivos }));
    } catch {
      setAvisoMsg(t("avisos_probar_error"));
    } finally {
      setProbandoAviso(false);
    }
  }

  async function guardar(activo: boolean, valor: string): Promise<boolean> {
    const limpio = valor.trim();
    if (limpio && !CORREO.test(limpio)) { setError(t("account_avisos_correo_invalido")); return false; }
    setError(null);
    const propia = !limpio || limpio.toLowerCase() === cuenta.toLowerCase() ? null : limpio;
    const r = await guardarAvisosCorreo(activo, propia);
    if (typeof r === "string") { setError(r); return false; }
    guardada.current = limpio || cuenta;
    refrescarYo();
    return true;
  }

  async function cambiarCorreo(activo: boolean) {
    setCorreoActivo(activo);
    setGuardado(false);
    if (!await guardar(activo, direccion)) setCorreoActivo(!activo);
  }

  async function salirDelCampo() {
    if (direccion.trim() === guardada.current) return;
    if (await guardar(true, direccion)) {
      if (!direccion.trim()) setDireccion(cuenta);
      setGuardado(true);
    }
  }

  const pushFijo = push.ocupado || push.estado === "cargando" || push.estado === "no-disponible"
    || push.estado === "bloqueado";
  const notaPush = push.estado === "bloqueado" ? t("account_avisos_bloqueados")
    : push.estado === "no-disponible" ? t("account_avisos_no_disponibles")
    : avisoMsg || t("account_avisos_push_pie");

  return <>
    <BarraCuenta titulo={t("account_avisos")} />
    <CuerpoCuenta>
      <CabGrupo>{t("account_avisos_grupo_dispositivo")}</CabGrupo>
      <Grupo>
        <li><div className="cu-celda"><span>{t("account_avisos_push")}</span><span />
          <Interruptor activo={push.estado === "activo"} etiqueta={t("account_avisos_push")} desactivado={pushFijo}
            onCambio={activo => void (activo ? push.activar() : push.desactivar())} />
        </div></li>
        {push.estado === "activo" && <li>
          <button type="button" className="cu-celda accion" disabled={probandoAviso || push.ocupado}
            onClick={() => void probarAviso()}>
            {probandoAviso ? t("account_enviando") : t("account_avisos_probar")}</button>
        </li>}
      </Grupo>
      <Pie>{notaPush}</Pie>
      {push.error && <Pie mal alerta>{push.error}</Pie>}

      <CabGrupo>{t("account_avisos_grupo_correo")}</CabGrupo>
      <Grupo>
        <li><div className="cu-celda"><span>{t("account_avisos_por_correo")}</span><span />
          <Interruptor activo={correoActivo} etiqueta={t("account_avisos_por_correo")}
            onCambio={activo => void cambiarCorreo(activo)} />
        </div></li>
        {correoActivo && <li><label className="cu-celda cu-campo">
          <span>{t("account_avisos_enviar_a")}</span>
          <input id="avisos-direccion" type="email" inputMode="email" autoComplete="email" autoCapitalize="none"
            maxLength={254} value={direccion}
            onChange={e => { setDireccion(e.target.value); setGuardado(false); setError(null); }}
            onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
            onBlur={() => void salirDelCampo()} />
        </label></li>}
      </Grupo>
      {error ? <Pie mal alerta>{error}</Pie>
        : correoActivo && <Pie>{guardado ? t("account_avisos_guardado") : t("account_avisos_enviar_a_ayuda")}</Pie>}

      <Grupo>
        <li><div className="cu-celda"><span>{t("account_avisos_resumen")}</span><span />
          <Interruptor activo={resumenActivo} etiqueta={t("account_avisos_resumen")} desactivado={resumenOcupado}
            onCambio={activo => void cambiarResumen(activo)} />
        </div></li>
      </Grupo>
      <Pie>{t("account_avisos_resumen_pie")}</Pie>
      {resumenError && <Pie mal alerta>{t("avisos_resumen_error")}</Pie>}
    </CuerpoCuenta>
  </>;
}
