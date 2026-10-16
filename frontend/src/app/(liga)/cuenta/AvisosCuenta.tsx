"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { guardarAvisosCorreo, probarAvisoCuenta } from "@/lib/liga/avisos";
import { useSesion } from "../_sesion/SesionContext";
import { Interruptor } from "./Interruptor";
import { usePushDispositivo } from "./usePushDispositivo";

const CORREO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Avisos de la cuenta: push en este dispositivo, correo y a qué dirección. La dirección se guarda al
 *  salir del campo; vacía o igual a la de la cuenta, queda como «la de la cuenta». */
export function AvisosCuenta({ email }: { email: string | null }) {
  const t = useTranslations();
  const { yo, refrescarYo } = useSesion();
  const push = usePushDispositivo();
  const cuenta = email ?? "";
  const [correoActivo, setCorreoActivo] = useState(Boolean(yo?.avisos_correo));
  const [direccion, setDireccion] = useState(yo?.correo_avisos ?? cuenta);
  const guardada = useRef(direccion);
  const [guardado, setGuardado] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  return <section className="ajustes-grupo" aria-label={t("account_avisos")}>
    <ul className="ajustes-lista">
      <li><div className="ajustes-fila ajustes-con-sub">
        <span className="ajustes-texto"><span className="ajustes-nombre">{t("account_avisos_push")}</span>
          <span className="ajustes-sub">{t("account_avisos_push_sub")}</span></span>
        <Interruptor activo={push.estado === "activo"} etiqueta={t("account_avisos_push")} desactivado={pushFijo}
          onCambio={activo => void (activo ? push.activar() : push.desactivar())} />
      </div></li>
      {push.estado === "activo" && <li className="ajustes-campo">
        <button type="button" className="btn small wide" disabled={probandoAviso || push.ocupado}
          onClick={() => void probarAviso()}>{t("avisos_probar_boton")}</button>
        {avisoMsg && <p className="ajustes-sub" role="status">{avisoMsg}</p>}
      </li>}
      <li><div className="ajustes-fila">
        <span className="ajustes-texto"><span className="ajustes-nombre">{t("account_avisos_correo")}</span></span>
        <Interruptor activo={correoActivo} etiqueta={t("account_avisos_correo")}
          onCambio={activo => void cambiarCorreo(activo)} />
      </div></li>
      {correoActivo && <li className="ajustes-campo">
        <label className="lbl" htmlFor="avisos-direccion">{t("account_avisos_enviar_a")}</label>
        <input id="avisos-direccion" className="inp" type="email" inputMode="email" autoComplete="email"
          autoCapitalize="none" maxLength={254} value={direccion}
          onChange={e => { setDireccion(e.target.value); setGuardado(false); }}
          onBlur={() => void salirDelCampo()} />
        <span className="ajustes-sub" role="status">
          {guardado ? t("account_avisos_guardado") : t("account_avisos_enviar_a_ayuda")}</span>
      </li>}
    </ul>
    {push.estado === "no-disponible" && <p className="ajustes-nota">{t("account_avisos_no_disponibles")}</p>}
    {push.estado === "bloqueado" && <p className="ajustes-nota">{t("account_avisos_bloqueados")}</p>}
    {push.error && <p className="ajustes-nota aviso" role="alert">{push.error}</p>}
    {error && <p className="ajustes-nota aviso" role="alert">{error}</p>}
  </section>;
}
