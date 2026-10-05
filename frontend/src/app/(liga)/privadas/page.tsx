"use client";

// Una liga reúne personas; su estrategia representante se obtiene de la competición.

import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { normalizeLocale } from "@/i18n/locale";
import { useRouter } from "next/navigation";
import { BarraPestanas, Boton, Cargando, ErrorLiga, Vacio } from "../_ui";
import { crearLiga, misLigas, unirseLiga, type LigaResumen } from "@/lib/liga/api";
import { invalidar, useCache } from "@/lib/liga/cache";
import { useSesionRequerida } from "../_sesion/SesionContext";
import { claseSigno, porcentaje } from "@/lib/liga/format";
import "./privadas.css";

type Hoja = "unirse" | "crear" | null;

function HojaPrivadas({ abierta, titulo, onCerrar, children }: {
  abierta: boolean; titulo: string; onCerrar: () => void; children: ReactNode;
}) {
  const t = useTranslations();
  const dialogo = useRef<HTMLDialogElement>(null);
  const idTitulo = useId();
  useEffect(() => {
    const d = dialogo.current;
    if (!abierta || !d) return;
    d.showModal();
    return () => d.close();
  }, [abierta]);
  return (
    <dialog ref={dialogo} className="priv-hoja" aria-labelledby={idTitulo} onCancel={onCerrar}>
      <div className="priv-hoja-cab">
        <h2 id={idTitulo}>{titulo}</h2>
        <button type="button" className="priv-hoja-cerrar" aria-label={t("private_leagues_close")} onClick={onCerrar}>×</button>
      </div>
      {children}
    </dialog>
  );
}

export default function Privadas() {
  const t = useTranslations();
  const locale = normalizeLocale(useLocale()) ?? "es";
  const percent = (value: number) => porcentaje(value, 1, locale);
  const router = useRouter();
  const { estado, yo } = useSesionRequerida("/privadas");
  const sesionLista = estado !== "cargando";
  const esPro = yo?.plan === "pro";

  const { datos: ligas, cargando, fallo, refrescar: cargar } = useCache<LigaResumen[] | string>(
    sesionLista && estado === "dentro" && esPro ? "mis-ligas" : null, misLigas,
  );
  const [hoja, setHoja] = useState<Hoja>(null);
  const [nombre, setNombre] = useState("");
  const [codigo, setCodigo] = useState("");
  const [ocupada, setOcupada] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const abrirHoja = (valor: Hoja) => { setAviso(null); setHoja(valor); };

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
          <div className="priv-barra">
            <Boton variante="principal" onClick={() => abrirHoja("crear")}>{t("private_leagues_create_button")}</Boton>
            <Boton onClick={() => abrirHoja("unirse")}>{t("private_leagues_join_button")}</Boton>
          </div>

          {ligas && ligas.length === 0 ? (
            <Vacio titulo={t("private_leagues_empty_title")}
                   texto={t("private_leagues_empty_text")} />
          ) : (
            <div className="priv-lista">
              {ligas?.map((l) => {
                const mes = l.mes == null ? null : Number(l.mes);
                const sp = l.sp500_mes == null ? null : Number(l.sp500_mes);
                return (
                  <Link key={l.id} href={`/privadas/${l.id}`} className="priv-liga">
                    <span className="priv-liga-cab">
                      <h3>{l.nombre}</h3>
                      <span className="priv-eyebrow">{t("private_leagues_people", { count: l.n_miembros })}</span>
                    </span>
                    {mes !== null ? (
                      <>
                        <span className="priv-liga-cifra">
                          <b className={`num ${claseSigno(mes)}`}>{percent(mes)}</b>
                          <span className="num">{sp !== null ? t("private_leagues_month_vs", { sp: percent(sp) }) : t("private_leagues_this_month")}</span>
                        </span>
                        {l.lider && <span className="priv-liga-lider">{t("private_leagues_leads")} <b>{l.lider}</b></span>}
                      </>
                    ) : (
                      <span className="priv-liga-vacio">{t("private_leagues_no_month_result")}</span>
                    )}
                  </Link>
                );
              })}
            </div>
          )}

          <HojaPrivadas abierta={hoja === "unirse"} titulo={t("private_leagues_invited_title")} onCerrar={() => setHoja(null)}>
            <p className="meta">{t("private_leagues_invited_text")}</p>
            <form className="form" onSubmit={alUnirse}>
              <label htmlFor="liga-codigo">{t("private_leagues_invite_code")}</label>
              <input id="liga-codigo" className="inp codigo" placeholder="ABC123" maxLength={16} value={codigo}
                     onChange={(e) => setCodigo(e.target.value.toUpperCase())}
                     autoCapitalize="characters" />
              <Boton type="submit" variante="principal" ancho="completo" disabled={ocupada || !codigo.trim()}>
                {ocupada ? t("private_leagues_wait") : t("private_leagues_join")}
              </Boton>
            </form>
            <p className="fine">{t("private_leagues_members_see")}</p>
            {aviso && hoja === "unirse" && <p className="aviso" role="alert">{aviso}</p>}
          </HojaPrivadas>

          <HojaPrivadas abierta={hoja === "crear"} titulo={t("private_leagues_create_group_title")} onCerrar={() => setHoja(null)}>
            <p className="meta">{t("private_leagues_create_group_text")}</p>
            <form className="form" onSubmit={alCrear}>
              <label htmlFor="liga-nombre">{t("private_leagues_name")}</label>
              <input id="liga-nombre" className="inp" placeholder={t("private_leagues_name_placeholder")} maxLength={40} value={nombre}
                     onChange={(e) => setNombre(e.target.value)} />
              <Boton type="submit" variante="principal" ancho="completo" disabled={ocupada || !nombre.trim()}>
                {ocupada ? t("private_leagues_wait") : t("private_leagues_create")}
              </Boton>
            </form>
            <p className="fine">{t("private_leagues_members_see")}</p>
            {aviso && hoja === "crear" && <p className="aviso" role="alert">{aviso}</p>}
          </HojaPrivadas>
        </>
      )}

      <BarraPestanas />
    </main>
  );
}
