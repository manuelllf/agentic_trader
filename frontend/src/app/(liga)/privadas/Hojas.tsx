"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { normalizeLocale } from "@/i18n/locale";
import { crearLiga, unirseLiga, type LigaDetalle } from "@/lib/liga/api";
import { invalidar } from "@/lib/liga/cache";
import { fecha } from "@/lib/liga/format";
import { Hoja } from "../_ui/Hoja";

// Letras y cifras que admite el código: sin I, O, 0 ni 1, como en el servidor.
const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const LONGITUD_CODIGO = 8;

function codigoLimpio(valor: string): string {
  return valor.toUpperCase().split("").filter((c) => ALFABETO.includes(c)).join("").slice(0, LONGITUD_CODIGO);
}

export function HojaUnirse({ abierta, onCerrar, onUnida }: {
  abierta: boolean; onCerrar: () => void; onUnida: (id: string) => void;
}) {
  const t = useTranslations();
  const [codigo, setCodigo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ocupada, setOcupada] = useState(false);

  const cerrar = () => { setCodigo(""); setError(null); onCerrar(); };
  const enviar = async () => {
    setOcupada(true);
    setError(null);
    const r = await unirseLiga(codigo);
    setOcupada(false);
    if (typeof r === "string") { setError(r); return; }
    invalidar("mis-ligas");
    setCodigo("");
    onUnida(r.id);
  };

  return (
    <Hoja abierta={abierta} titulo={t("private_leagues_join_title")} cancelar={t("common_cancelar")}
      accion={t("private_leagues_join_short")} accionDesactivada={ocupada || codigo.length !== LONGITUD_CODIGO}
      onAccion={enviar} onCerrar={cerrar}>
      <label className={`pv-campo${error ? " error" : ""}`}>
        <input className="pv-codigo" value={codigo} maxLength={LONGITUD_CODIGO} inputMode="text"
          autoCapitalize="characters" autoComplete="off" spellCheck={false}
          placeholder={t("private_leagues_invite_code")} aria-label={t("private_leagues_invite_code")}
          aria-invalid={error ? true : undefined}
          onChange={(e) => { setCodigo(codigoLimpio(e.target.value)); setError(null); }} />
      </label>
      {error && <p className="pv-error" role="alert">{error}</p>}
    </Hoja>
  );
}

export function HojaCrear({ abierta, onCerrar, onCreada }: {
  abierta: boolean; onCerrar: () => void; onCreada: (id: string) => void;
}) {
  const t = useTranslations();
  const [nombre, setNombre] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ocupada, setOcupada] = useState(false);

  const cerrar = () => { setNombre(""); setError(null); onCerrar(); };
  const enviar = async () => {
    const limpio = nombre.trim();
    if (!limpio) return;
    setOcupada(true);
    setError(null);
    const r = await crearLiga(limpio);
    setOcupada(false);
    if (typeof r === "string") { setError(r); return; }
    invalidar("mis-ligas");
    setNombre("");
    onCreada(r.id);
  };

  return (
    <Hoja abierta={abierta} titulo={t("private_leagues_create_button")} cancelar={t("common_cancelar")}
      accion={t("private_leagues_create_short")} accionDesactivada={ocupada || !nombre.trim()}
      onAccion={enviar} onCerrar={cerrar}>
      <label className="pv-campo">
        <input value={nombre} maxLength={40} autoComplete="off" placeholder={t("private_leagues_name_placeholder")}
          aria-label={t("private_leagues_name")} onChange={(e) => setNombre(e.target.value)} />
      </label>
      {error && <p className="pv-error" role="alert">{error}</p>}
      <p className="pv-pie">{t("private_leagues_create_note")}</p>
    </Hoja>
  );
}

export function HojaMetodo({ abierta, onCerrar, consultado }: {
  abierta: boolean; onCerrar: () => void; consultado: string | null;
}) {
  const t = useTranslations();
  const locale = normalizeLocale(useLocale()) ?? "es";
  return (
    <Hoja abierta={abierta} titulo={t("private_leagues_method_title")} accion={t("private_leagues_done")} onCerrar={onCerrar}>
      <div className="pv-texto">
        <p>{t("private_leagues_rep_strategy_answer")}</p>
        <p>{t("private_leagues_cumulative_note")}</p>
        {consultado && <p>{t("private_leagues_market_checked", {
          time: new Date(consultado).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }),
        })}</p>}
        <p>{t("private_leagues_compare_note")} <Link className="pv-enlace" href="/como-funciona">{t("private_leagues_view_rules")} →</Link></p>
      </div>
    </Hoja>
  );
}

export function HojaMiembros({ abierta, onCerrar, liga, copiado, onCopiar, onRotar, onExpulsar, onSalir }: {
  abierta: boolean;
  onCerrar: () => void;
  liga: LigaDetalle;
  copiado: boolean;
  onCopiar: () => void;
  onRotar: () => void;
  onExpulsar: (alias: string) => void;
  onSalir: () => void;
}) {
  const t = useTranslations();
  const locale = normalizeLocale(useLocale()) ?? "es";
  const titulo = liga.es_dueno ? t("private_leagues_invite_button") : t("private_leagues_members_button");
  return (
    <Hoja abierta={abierta} titulo={titulo} accion={t("private_leagues_done")} onCerrar={onCerrar}>
      {liga.es_dueno && liga.codigo && (
        <>
          <p className="pv-codigo-gr" aria-label={t("private_leagues_invite_code")}>{liga.codigo}</p>
          <div className="pv-acciones">
            <button type="button" className="pv-boton" onClick={onCopiar}>
              {copiado ? t("private_leagues_code_copied") : t("private_leagues_copy_code")}
            </button>
          </div>
          <p className="pv-pie">{t("private_leagues_share_code_note")}</p>
        </>
      )}

      <p className="pv-cab-grupo"><span>{t("private_leagues_members_head")}</span><span className="num">{liga.n_miembros}</span></p>
      <div className="pv-grupo">
        {liga.miembros.map((m) => (
          <div className="pv-gfila" key={m.alias}>
            <span className="t">
              <b>{m.alias}{m.es_yo ? ` · ${t("private_leagues_you")}` : ""}</b>
              <small>{m.es_yo && liga.es_dueno
                ? t("private_leagues_owner")
                : t("private_leagues_member_since", { date: fecha(m.unido.slice(0, 10), new Date(), locale) })}</small>
            </span>
            {liga.es_dueno && !m.es_yo && (
              <button type="button" className="pv-expulsar" onClick={() => onExpulsar(m.alias)}>{t("private_leagues_remove")}</button>
            )}
          </div>
        ))}
      </div>

      {liga.es_dueno ? (
        <div className="pv-grupo pv-separado">
          <button type="button" className="pv-gfila pv-accion" onClick={onRotar}>{t("private_leagues_change_code")}</button>
        </div>
      ) : (
        <div className="pv-grupo pv-separado">
          <button type="button" className="pv-gfila pv-peligro" onClick={onSalir}>{t("private_leagues_leave")}</button>
        </div>
      )}
    </Hoja>
  );
}
