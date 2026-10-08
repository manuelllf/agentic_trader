"use client";

// Verificación en dos pasos con una app (Google Authenticator, 1Password…). Sin ella activa y
// superada en esta sesión, el Panel de control no abre.

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Boton, Cargando } from "../../_ui";
import { CampoCodigo } from "../../_ui/CampoCodigo";
import { MarcoAcceso } from "../../_ui/MarcoAcceso";
import { destinoSeguro, useSupabase } from "@/lib/liga/supabase";

type Estado =
  | { paso: "cargando" }
  | { paso: "alta"; factorId: string; qr: string; secreto: string }
  | { paso: "codigo"; factorId: string }
  | { paso: "hecho" };

export default function Verificacion() {
  const t = useTranslations();
  const sb = useSupabase();
  const [estado, setEstado] = useState<Estado>({ paso: "cargando" });
  const [codigo, setCodigo] = useState("");
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [destino, setDestino] = useState("/liga");

  useEffect(() => {
    const next = destinoSeguro(new URLSearchParams(window.location.search).get("next"));
    setDestino(next);
    if (!sb) return;
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
        factorType: "totp", friendlyName: "Vennett",
      });
      if (fallo || !data) {
        setError("account_verificacion_preparar_fallo");
        return;
      }
      setEstado({ paso: "alta", factorId: data.id, qr: data.totp.qr_code, secreto: data.totp.secret });
    })();
  }, [sb]);

  const verificar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sb || ocupado || (estado.paso !== "alta" && estado.paso !== "codigo")) return;
    setOcupado(true);
    setError("");
    try {
      const { error: fallo } = await sb.auth.mfa.challengeAndVerify({
        factorId: estado.factorId, code: codigo.trim(),
      });
      if (fallo) {
        setError("account_codigo_invalido");
        return;
      }
      await sb.auth.refreshSession();
      setEstado({ paso: "hecho" });
    } finally {
      setOcupado(false);
    }
  };

  const formCodigo = (
    <form className="form" onSubmit={verificar}>
      <CampoCodigo value={codigo} onChange={setCodigo} autoFocus disabled={ocupado} />
      {error && <p className="aviso" role="alert">{t(error)}</p>}
      <Boton type="submit" variante="principal" ancho="completo"
             disabled={ocupado || codigo.length !== 6}>
        {ocupado ? t("account_comprobando") : t("account_verificar")}
      </Boton>
    </form>
  );

  return (
    <MarcoAcceso modo="tramite" titular={t("account_verificacion")}>
      {sb === null ? (
        <p className="nota">{t("account_cuentas_cerradas")}</p>
      ) : estado.paso === "cargando" ? (
        error ? <p className="aviso" role="alert">{t(error)}</p> : <Cargando filas={2} />
      ) : estado.paso === "alta" ? (
        <>
          <p className="nota">{t("account_escanear_qr")}</p>
          {/* eslint-disable-next-line @next/next/no-img-element -- QR en data URI de Supabase */}
          <img className="qr" src={estado.qr} alt={t("account_qr_alt")} />
          <p className="secreto">
            {t("account_clave_manual")} <b className="num">{estado.secreto}</b>
          </p>
          {formCodigo}
        </>
      ) : estado.paso === "codigo" ? (
        <>
          <p className="nota">{t("account_codigo_actual")}</p>
          {formCodigo}
        </>
      ) : (
        <>
          <p className="nota">{t("account_sesion_verificada")}</p>
          <Link href={destino} className="btn pri wide">{t("account_seguir")}</Link>
        </>
      )}
    </MarcoAcceso>
  );
}
