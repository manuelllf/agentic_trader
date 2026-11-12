"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { normalizeLocale } from "@/i18n/locale";
import { CabeceraApp, BarraPestanas, Cargando, ErrorLiga, Vacio } from "../_ui";
import { misLigas, type LigaResumen } from "@/lib/liga/api";
import { useCache } from "@/lib/liga/cache";
import { signo } from "@/lib/liga/format";
import { useSesionRequerida } from "../_sesion/SesionContext";
import { HojaCrear, HojaUnirse } from "./Hojas";
import "../liga/ranking.css";
import "./privadas.css";

/** Umbral de empate de la liga: a ±0,2 pp del S&P no hay ni ganancia ni pérdida (motor/puntos.py). */
const BANDA_EMPATE = 0.2;

function claseVs(vs: number): "bien" | "mal" | "" {
  return vs > BANDA_EMPATE ? "bien" : vs < -BANDA_EMPATE ? "mal" : "";
}

function Chevron() {
  return (
    <svg className="pv-chev" width="8" height="13" viewBox="0 0 8 13" aria-hidden="true">
      <path d="M1.5 1.5 6.5 6.5l-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** «+» de la cabecera: unirse siempre; crear, si la cuenta puede (hoy, cualquiera). */
function MenuMas({ puedeCrear, alUnirse, alCrear }: { puedeCrear: boolean; alUnirse: () => void; alCrear: () => void }) {
  const t = useTranslations();
  const [abierto, setAbierto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: PointerEvent) => { if (!raiz.current?.contains(e.target as Node)) setAbierto(false); };
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") setAbierto(false); };
    document.addEventListener("pointerdown", fuera);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("pointerdown", fuera);
      document.removeEventListener("keydown", tecla);
    };
  }, [abierto]);

  return (
    <div className="pv-menu-raiz" ref={raiz}>
      <button type="button" className="pv-mas" aria-label={t("private_leagues_add_menu")}
        aria-haspopup="menu" aria-expanded={abierto} onClick={() => setAbierto((a) => !a)}>
        <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      </button>
      {abierto && (
        <div className="pv-menu" role="menu">
          <button type="button" role="menuitem" onClick={() => { setAbierto(false); alUnirse(); }}>
            {t("private_leagues_join_button")}
          </button>
          {puedeCrear && (
            <button type="button" role="menuitem" onClick={() => { setAbierto(false); alCrear(); }}>
              {t("private_leagues_create_button")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Una liga: nombre, personas, quién va primero y tu diferencia con el S&P de la semana. */
function FilaLiga({ liga }: { liga: LigaResumen }) {
  const t = useTranslations();
  const locale = normalizeLocale(useLocale()) ?? "es";
  const mio = liga.mio == null ? null : Number(liga.mio);
  const sp = liga.sp500_mes == null ? null : Number(liga.sp500_mes);
  const vs = mio != null && sp != null ? mio - sp : null;
  const personas = t("private_leagues_people", { count: liga.n_miembros });
  // Sin resultado de la semana no se añade nada más: la línea cabe entera en el móvil.
  const sub = [personas, mio != null && liga.lider ? `${t("private_leagues_leads")} ${liga.lider}` : null]
    .filter(Boolean).join(" · ");
  return (
    <li className="lv-fila pv-liga">
      <Link href={`/privadas/${liga.id}`} className="lv-fila-abre pv-abre">
        <span className="lv-nombre"><b>{liga.nombre}</b><small>{sub}</small></span>
        <Chevron />
      </Link>
      {vs != null && <span className={`lv-pildora ${claseVs(vs)}`}>{signo(vs, 1, locale)}</span>}
    </li>
  );
}

export default function Privadas() {
  const t = useTranslations();
  const { estado, yo } = useSesionRequerida("/privadas");
  const router = useRouter();
  const sesionLista = estado !== "cargando";
  const puedeCrear = !!yo?.puede_crear_liga;

  const { datos: ligas, cargando, fallo, refrescar: cargar } = useCache<LigaResumen[] | string>(
    sesionLista && estado === "dentro" ? "mis-ligas" : null, misLigas,
  );
  const [hoja, setHoja] = useState<"unirse" | "crear" | null>(null);

  const irA = (id: string) => { setHoja(null); router.push(`/privadas/${id}`); };

  let contenido;
  if (!sesionLista || (estado === "dentro" && !yo) || cargando) {
    contenido = <Cargando filas={3} />;
  } else if (fallo || typeof ligas === "string") {
    contenido = <ErrorLiga titulo={t("private_leagues_load_error")}
      mensaje={typeof ligas === "string" ? ligas : t("private_leagues_retry_later")}
      accion={{ texto: t("private_leagues_retry"), onClick: cargar }} />;
  } else if (ligas && ligas.length === 0) {
    contenido = (
      <>
        <Vacio titulo={t("private_leagues_empty_title")} texto={t("private_leagues_empty_text")}
          accion={{ texto: t("private_leagues_join_button"), onClick: () => setHoja("unirse") }} />
        <p className="pv-pie">{t("private_leagues_create_needs_pro")}</p>
      </>
    );
  } else {
    contenido = (
      <ul className="lv-lista">
        {ligas?.map((l) => <FilaLiga key={l.id} liga={l} />)}
      </ul>
    );
  }

  return (
    <main className="scroll lv-pagina pv">
      <CabeceraApp anio={2026} />
      <div className="pv-titulo-fila">
        <h1 className="pv-titulo">{t("private_leagues_title")}</h1>
        <MenuMas puedeCrear={puedeCrear} alUnirse={() => setHoja("unirse")} alCrear={() => setHoja("crear")} />
      </div>
      {contenido}

      <HojaUnirse abierta={hoja === "unirse"} onCerrar={() => setHoja(null)} onUnida={irA} />
      {puedeCrear && <HojaCrear abierta={hoja === "crear"} onCerrar={() => setHoja(null)} onCreada={irA} />}

      <BarraPestanas />
    </main>
  );
}
