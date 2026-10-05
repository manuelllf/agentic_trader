"use client";

// Una liga reúne personas; su estrategia representante se obtiene de la competición.

import Link from "next/link";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { normalizeLocale } from "@/i18n/locale";
import { useRouter } from "next/navigation";
import { BarraPestanas, Boton, Cargando, ErrorLiga, Vacio } from "../_ui";
import { crearLiga, misLigas, unirseLiga, type LigaResumen } from "@/lib/liga/api";
import { invalidar, useCache } from "@/lib/liga/cache";
import { useSesionRequerida } from "../_sesion/SesionContext";
import { fecha } from "@/lib/liga/format";
import "./privadas.css";

export default function Privadas() {
  const t = useTranslations();
  const locale = normalizeLocale(useLocale()) ?? "es";
  const fechaLiga = (value: string) => fecha(value, new Date(), locale);
  const router = useRouter();
  const { estado, yo } = useSesionRequerida("/privadas");
  const sesionLista = estado !== "cargando";
  const esPro = yo?.plan === "pro";

  const { datos: ligas, cargando, fallo, refrescar: cargar } = useCache<LigaResumen[] | string>(
    sesionLista && estado === "dentro" && esPro ? "mis-ligas" : null, misLigas,
  );
  const [nombre, setNombre] = useState("");
  const [codigo, setCodigo] = useState("");
  const [ocupada, setOcupada] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  async function alCrear(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre.trim()) return;
    setOcupada(true);
    setAviso(null);
    const r = await crearLiga(nombre.trim());
    setOcupada(false);
    if (typeof r === "string") { setAviso(r); return; }
    setNombre("");
    invalidar("mis-ligas"); router.push(`/privadas/${r.id}`);
  }

  async function alUnirse(e: React.FormEvent) {
    e.preventDefault();
    if (!codigo.trim()) return;
    setOcupada(true);
    setAviso(null);
    const r = await unirseLiga(codigo.trim());
    setOcupada(false);
    if (typeof r === "string") { setAviso(r); return; }
    setCodigo("");
    invalidar("mis-ligas"); router.push(`/privadas/${r.id}`);
  }

  return (
    <main className="scroll privadas">
      <h1 className="h1">{t("private_leagues_title")}</h1>
      <p className="meta">{t("private_leagues_intro")}</p>

      {!sesionLista || (estado === "dentro" && !yo) || (esPro && cargando) ? (
        <div style={{ marginTop: 20 }}><Cargando filas={3} /></div>
      ) : !esPro ? (
        <div className="empty">
          <h2>{t("private_leagues_pro_title")}</h2>
          <p>
            {t("private_leagues_pro_text")}
          </p>
        </div>
      ) : fallo || typeof ligas === "string" ? (
        <ErrorLiga titulo={t("private_leagues_load_error")} mensaje={typeof ligas === "string" ? ligas : t("private_leagues_retry_later")}
                   accion={{ texto: t("private_leagues_retry"), onClick: cargar }} />
      ) : (
        <>
          {ligas && ligas.length === 0 ? (
            <Vacio titulo={t("private_leagues_empty_title")}
                   texto={t("private_leagues_empty_text")} />
          ) : (
            <section className="sec">
              <h2 className="sec-t">{t("private_leagues_mine_count", { count: ligas?.length ?? 0 })}</h2>
              <div className="priv-lista">
                {ligas?.map((l) => (
                  <Link key={l.id} href={`/privadas/${l.id}`} className="priv-liga">
                    <span className="priv-eyebrow">{l.es_dueno ? t("private_leagues_owner") : t("private_leagues_member")}</span>
                    <h3>{l.nombre}</h3>
                    <span className="priv-liga-miembros"><b>{l.n_miembros}</b> {t("private_leagues_participants", { count: l.n_miembros })} <small>· {t("private_leagues_spots_left", { count: l.cupo - l.n_miembros })}</small></span>
                    <span className="priv-liga-pie"><small>{t("private_leagues_since", { date: fechaLiga(l.creada.slice(0, 10)) })}</small><span>{t("private_leagues_view_results")} →</span></span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          <div className="priv-accesos">
          <section className="priv-panel">
            <h2>{t("private_leagues_invited_title")}</h2>
            <p>{t("private_leagues_invited_text")}</p>
            <p className="fine">{t("private_leagues_members_see")}</p>
            <form className="form" style={{ marginTop: 0, gap: 12 }} onSubmit={alUnirse}>
              <label htmlFor="liga-codigo">{t("private_leagues_invite_code")}</label>
              <input id="liga-codigo" className="inp codigo" placeholder="ABC123" maxLength={16} value={codigo}
                     onChange={(e) => setCodigo(e.target.value.toUpperCase())}
                     autoCapitalize="characters" />
              <Boton type="submit" variante="secundario" ancho="completo" disabled={ocupada || !codigo.trim()}>
                {ocupada ? t("private_leagues_wait") : t("private_leagues_join")}
              </Boton>
            </form>
          </section>

          <section className="priv-panel">
            <h2>{t("private_leagues_create_group_title")}</h2>
            <p>{t("private_leagues_create_group_text")}</p>
            <p className="fine">{t("private_leagues_members_see")}</p>
            <form className="form" style={{ marginTop: 0, gap: 12 }} onSubmit={alCrear}>
              <label htmlFor="liga-nombre">{t("private_leagues_name")}</label>
              <input id="liga-nombre" className="inp" placeholder={t("private_leagues_name_placeholder")} maxLength={40} value={nombre}
                     onChange={(e) => setNombre(e.target.value)} />
              <Boton type="submit" variante="principal" ancho="completo" disabled={ocupada || !nombre.trim()}>
                {ocupada ? t("private_leagues_wait") : t("private_leagues_create")}
              </Boton>
            </form>
          </section>

          </div>
          {aviso && <p className="aviso" role="alert" style={{ marginTop: 16 }}>{aviso}</p>}
        </>
      )}

      <BarraPestanas />
    </main>
  );
}
