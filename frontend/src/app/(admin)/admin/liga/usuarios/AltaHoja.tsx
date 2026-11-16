"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ApiError, post } from "@/lib/api";
import { Hoja } from "../../_panel/ui";
import { Campo } from "./pp";

type Alta = { id: string; email: string; alias: string; alias_aplicado: boolean; clave_temporal: string };

const CORREO = /^\S+@\S+\.\S+$/;

/** Alta a mano: crea la cuenta ya confirmada y enseña la contraseña temporal una sola vez. */
export function AltaHoja({ onAlta, onCerrar }: { onAlta: () => void; onCerrar: () => void }) {
  const t = useTranslations();
  const [email, setEmail] = useState("");
  const [alias, setAlias] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [fallo, setFallo] = useState("");
  const [alta, setAlta] = useState<Alta | null>(null);
  const [copiado, setCopiado] = useState(false);
  const correoValido = CORREO.test(email.trim());

  const crear = async () => {
    if (ocupado || !correoValido) return;
    setOcupado(true); setFallo("");
    try {
      const res = await post<Alta>("/liga/admin/usuarios", { email: email.trim(), alias: alias.trim() || null });
      setAlta(res); setCopiado(false); setEmail(""); setAlias("");
      onAlta();
    } catch (err) {
      setFallo(err instanceof ApiError ? err.message : t("admin_generic_error"));
    } finally {
      setOcupado(false);
    }
  };

  const copiar = async () => {
    if (!alta) return;
    try {
      await navigator.clipboard.writeText(`${alta.email}\n${alta.clave_temporal}`);
      setCopiado(true);
    } catch { /* sin portapapeles: se copia a mano */ }
  };

  return (
    <Hoja abierta titulo={t("pnl_personas_alta_titulo")} cancelar={alta ? undefined : t("common_cancelar")}
      accion={alta ? t("admin_pnl_listo") : ocupado ? t("pnl_personas_alta_creando") : t("pnl_personas_alta_crear")}
      accionDesactivada={!alta && (ocupado || !correoValido)} onAccion={alta ? onCerrar : crear} onCerrar={onCerrar}>
      <div className="pp-hoja">
        {!alta && (
          <>
            <Campo etiqueta={t("pnl_personas_alta_correo")} type="email" inputMode="email" autoCapitalize="none" value={email}
              onChange={e => setEmail(e.target.value)} pie={email && !correoValido ? t("pnl_personas_alta_correo_invalido") : undefined} />
            <Campo etiqueta={t("pnl_personas_alta_alias")} maxLength={20} autoCapitalize="none" value={alias} onChange={e => setAlias(e.target.value)} />
          </>
        )}
        {fallo && <p className="pp-aviso" role="alert">{fallo}</p>}
        {alta && (
          <div className="pp-resultado">
            <p>{t("pnl_personas_alta_hecha")}</p>
            <p><b>{alta.email}</b></p>
            <p><b>{alta.clave_temporal}</b></p>
            {!alta.alias_aplicado && <p>{t("pnl_personas_alta_alias_invalido", { alias: alta.alias })}</p>}
            <p>{t("pnl_personas_alta_cambiar_clave")}</p>
            <button type="button" className="pp-boton" onClick={copiar}>
              {copiado ? t("pnl_personas_alta_copiado") : t("pnl_personas_alta_copiar")}
            </button>
          </div>
        )}
      </div>
    </Hoja>
  );
}
