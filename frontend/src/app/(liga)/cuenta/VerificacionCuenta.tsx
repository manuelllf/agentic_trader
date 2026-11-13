"use client";

// Verificación en dos pasos con una app (Google Authenticator, 1Password…). Sin ella activa y
// superada en esta sesión, el Panel de control no abre.

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { destinoSeguro, useSupabase } from "@/lib/liga/supabase";
import { useSesion } from "../_sesion/SesionContext";
import { BarraCuenta, CabGrupo, CuerpoCuenta, Grupo, Pie, useNavCuenta } from "./marco";

type Estado =
  | { paso: "cargando" }
  | { paso: "alta"; factorId: string; qr: string; secreto: string; uri: string }
  | { paso: "codigo"; factorId: string }
  | { paso: "hecho" };

// Mismo comportamiento que CampoCodigo, con la cuadrícula en el propio fieldset (cu-seis).
function SeisCifras({ value, onChange, disabled, error, enfocar }: {
  value: string; onChange: (valor: string) => void; disabled: boolean; error: boolean; enfocar: number;
}) {
  const t = useTranslations();
  const casillas = useRef<(HTMLInputElement | null)[]>([]);
  const foco = (i: number) => casillas.current[Math.max(0, Math.min(5, i))]?.focus();
  useEffect(() => { casillas.current[0]?.focus(); }, [enfocar]);
  const repartir = (texto: string) => {
    const digitos = texto.replace(/\D/g, "").slice(0, 6);
    if (!digitos) return;
    onChange(digitos);
    foco(Math.min(digitos.length, 5));
  };
  return <fieldset className={"cu-seis" + (error ? " mal" : "")} disabled={disabled}>
    <legend className="sr-only">{t("auth_codigo")}</legend>
    {Array.from({ length: 6 }, (_, i) => <input key={i}
      ref={elemento => { casillas.current[i] = elemento; }}
      type="text" inputMode="numeric" maxLength={i === 0 ? 6 : 1}
      autoComplete={i === 0 ? "one-time-code" : "off"}
      aria-label={t("auth_codigo_digito", { n: i + 1, total: 6 })}
      value={value[i] ?? ""} onFocus={e => e.target.select()}
      onPaste={e => { e.preventDefault(); repartir(e.clipboardData.getData("text")); }}
      onChange={e => {
        const texto = e.target.value;
        const digitos = texto.replace(/\D/g, "");
        if (digitos.length > 1) { repartir(texto); return; }
        if (texto && !digitos) return;
        onChange((value.slice(0, i) + digitos + value.slice(i + 1)).slice(0, 6));
        if (digitos) foco(i + 1);
      }}
      onKeyDown={e => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault(); foco(i + (e.key === "ArrowLeft" ? -1 : 1));
        } else if (e.key === "Backspace" && !value[i] && i > 0) {
          e.preventDefault(); onChange(value.slice(0, i - 1) + value.slice(i)); foco(i - 1);
        }
      }} />)}
  </fieldset>;
}

export function VerificacionCuenta() {
  const t = useTranslations();
  const sb = useSupabase();
  const { refrescarYo } = useSesion();
  const { modo, avisar } = useNavCuenta();
  const alta = useRef({ cliente: sb, iniciada: false });
  const [estado, setEstado] = useState<Estado>({ paso: "cargando" });
  const [codigo, setCodigo] = useState("");
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [destino, setDestino] = useState<string | null>(null);
  const [movil, setMovil] = useState(false);
  const [verQr, setVerQr] = useState(false);
  const [enfocar, setEnfocar] = useState(0);

  useEffect(() => { setMovil(window.matchMedia("(pointer: coarse)").matches); }, []);

  useEffect(() => {
    const pedido = new URLSearchParams(window.location.search).get("next");
    const next = destinoSeguro(pedido);
    setDestino(pedido ? next : null);
    if (alta.current.cliente !== sb) alta.current = { cliente: sb, iniciada: false };
    // StrictMode repite el efecto mientras el primer alta sigue en marcha.
    if (!sb || alta.current.iniciada) return;
    alta.current.iniciada = true;
    (async () => {
      const { data: sesion } = await sb.auth.getSession();
      if (!sesion.session) {
        window.location.replace(`/entrar?next=${encodeURIComponent("/cuenta/verificacion?next=" + next)}`);
        return;
      }
      const { data: nivel } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
      if (nivel?.currentLevel === "aal2") {
        setEstado({ paso: "hecho" });
        return;
      }
      const { data: factores } = await sb.auth.mfa.listFactors();
      const activo = factores?.totp[0];
      if (activo) {
        setEstado({ paso: "codigo", factorId: activo.id });
        return;
      }
      // Un alta que se quedó a medias bloquearía la nueva: se retira antes.
      for (const f of factores?.all ?? []) {
        if (f.status === "unverified") await sb.auth.mfa.unenroll({ factorId: f.id });
      }
      const { data, error: fallo } = await sb.auth.mfa.enroll({
        factorType: "totp", friendlyName: `Vennett ${crypto.randomUUID()}`,
      });
      if (fallo || !data) {
        setError("account_verificacion_preparar_fallo");
        return;
      }
      setEstado({ paso: "alta", factorId: data.id, qr: data.totp.qr_code, secreto: data.totp.secret, uri: data.totp.uri });
    })();
  }, [sb]);

  const verificar = async () => {
    if (!sb || ocupado || codigo.length !== 6 || (estado.paso !== "alta" && estado.paso !== "codigo")) return;
    setOcupado(true);
    setError("");
    try {
      const { error: fallo } = await sb.auth.mfa.challengeAndVerify({
        factorId: estado.factorId, code: codigo.trim(),
      });
      if (fallo) {
        setError("account_codigo_invalido");
        setCodigo("");
        setEnfocar(n => n + 1);
        return;
      }
      await sb.auth.refreshSession();
      setEstado({ paso: "hecho" });
      avisar(t("account_verif_activada"));
      refrescarYo();
    } finally {
      setOcupado(false);
    }
  };

  const copiar = (secreto: string) => {
    void navigator.clipboard.writeText(secreto);
    avisar(t("account_clave_copiada"));
  };

  const seis = (
    <>
      <SeisCifras value={codigo} onChange={setCodigo} disabled={ocupado}
        error={error === "account_codigo_invalido"} enfocar={enfocar} />
      {error && <Pie mal alerta>{t(error)}</Pie>}
      <button type="button" className="cu-boton" disabled={codigo.length !== 6 || ocupado} onClick={verificar}>
        {ocupado ? t("account_comprobando") : t("account_verificar")}
      </button>
    </>
  );

  let cuerpo;
  if (sb === null) {
    cuerpo = <Pie>{t("auth_cuentas_cerradas")}</Pie>;
  } else if (estado.paso === "cargando") {
    cuerpo = error ? <Pie mal alerta>{t(error)}</Pie> : (
      <Grupo>
        {[60, 40].map(ancho => <li key={ancho}><div className="cu-celda">
          <span className="cu-esq" style={{ width: `${ancho}%` }} />
        </div></li>)}
      </Grupo>
    );
  } else if (estado.paso === "alta") {
    const secreto = estado.secreto.replace(/\s/g, "");
    cuerpo = <>
      <CabGrupo>{t("account_verif_paso1")}</CabGrupo>
      <Grupo>
        {movil && <li><a className="cu-celda accion" href={estado.uri}>{t("account_verif_abrir_app")}</a></li>}
        {(!movil || verQr) && <li><div className="cu-qr">
          {/* eslint-disable-next-line @next/next/no-img-element -- QR en data URI de Supabase */}
          <img src={estado.qr} alt={t("account_qr_alt")} />
        </div></li>}
        <li><div className="cu-celda cu-clave">
          <span className="t">
            <small>{movil ? t("account_verif_clave_movil") : t("account_verif_clave_escritorio")}</small>
            <b>{secreto.replace(/(.{4})(?=.)/g, "$1 ")}</b>
          </span>
          <button type="button" className="cu-copiar" onClick={() => copiar(secreto)}>{t("account_copiar")}</button>
        </div></li>
        {movil && <li><button type="button" className="cu-celda accion" onClick={() => setVerQr(v => !v)}>
          <span>{verQr ? t("account_verif_ocultar_qr") : t("account_verif_ver_qr")}</span>
        </button></li>}
      </Grupo>
      <Pie>{t("account_verif_apps")}</Pie>
      <CabGrupo>{t("account_verif_paso2")}</CabGrupo>
      {seis}
    </>;
  } else if (estado.paso === "codigo") {
    cuerpo = <>
      <CabGrupo>{t("account_verif_codigo_cab")}</CabGrupo>
      {seis}
    </>;
  } else {
    cuerpo = <>
      <Grupo><li><div className="cu-celda dato">
        <span>{t("account_verificacion")}</span><span className="valor">{t("account_activada")}</span>
      </div></li></Grupo>
      <Pie>{t("account_sesion_verificada")}</Pie>
      {modo === "pagina" && destino && destino !== "/cuenta" && (
        <Link className="cu-boton" href={destino}>{t("account_seguir")}</Link>
      )}
    </>;
  }

  return <>
    <BarraCuenta titulo={t("account_titulo_verificacion")} />
    <CuerpoCuenta>{cuerpo}</CuerpoCuenta>
  </>;
}
