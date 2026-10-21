"use client";
import { Boton } from "../../_marco/ui";

import { createPortal } from "react-dom";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { ApiError, post } from "@/lib/api";

type Alta = {
  id: string; email: string; alias: string; alias_aplicado: boolean; clave_temporal: string;
};

// Alta a mano: crea la cuenta ya confirmada y enseña la contraseña temporal una sola vez.
export function AltaUsuario({ onAlta, destino }: { onAlta: () => void; destino?: HTMLElement | null }) {
  const t = useTranslations();
  const [abierto, setAbierto] = useState(false);
  const [email, setEmail] = useState("");
  const [alias, setAlias] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [fallo, setFallo] = useState("");
  const [alta, setAlta] = useState<Alta | null>(null);
  const [copiado, setCopiado] = useState(false);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (ocupado) return;
    setOcupado(true); setFallo("");
    try {
      const res = await post<Alta>("/liga/admin/usuarios", { email, alias: alias.trim() || null });
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

  if (!abierto) {
    return (
      <Boton variante="sec" type="button" onClick={() => setAbierto(true)}
              >
        {t("admin_users_create")}
      </Boton>
    );
  }
  const formulario = (
    <section className="adm-usuarios-alta adm-bloque">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] text-white">{t("admin_users_create")}</h2>
        <Boton variante="sec" type="button" onClick={() => { setAbierto(false); setAlta(null); setFallo(""); }}
                className="min-h-[44px] px-2">{t("admin_users_close")}</Boton>
      </div>
      <form onSubmit={enviar} className="mt-2 flex flex-col gap-2">
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
               placeholder={t("admin_users_email")} autoCapitalize="none" autoCorrect="off" spellCheck={false}
               className="min-h-[44px] rounded-lg border px-3 text-white" />
        <input value={alias} onChange={(e) => setAlias(e.target.value)} maxLength={20}
               placeholder={t("admin_users_league_name")} autoCapitalize="none"
               autoCorrect="off" spellCheck={false}
               className="min-h-[44px] rounded-lg border px-3 text-white" />
        <Boton variante="sec" type="submit" disabled={ocupado || !email}
                className="min-h-[44px] rounded-lg px-4 font-bold text-white disabled:opacity-40">
          {ocupado ? t("admin_users_creating") : t("admin_users_create_account")}
        </Boton>
      </form>
      {fallo && <p className="mt-3 rounded-lg p-3">{fallo}</p>}
      {alta && (
        <div className="mt-3 rounded-lg p-3">
          <p>{t("admin_users_created_notice")}</p>
          <p className="mt-2 break-all text-white">{alta.email}</p>
          <p className="break-all text-white">{alta.clave_temporal}</p>
          {!alta.alias_aplicado && (
            <p className="mt-2">
              {t("admin_users_alias_invalid", { alias: alta.alias })}
            </p>
          )}
          <p className="mt-2">{t("admin_users_change_password")}</p>
          <Boton variante="sec" type="button" onClick={copiar}
                  className="mt-2 min-h-[44px] rounded-lg px-4">
            {copiado ? t("admin_users_copied") : t("admin_users_copy_credentials")}
          </Boton>
        </div>
      )}
    </section>
  );
  return destino ? createPortal(formulario, destino) : formulario;
}

