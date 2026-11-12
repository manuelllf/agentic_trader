"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { CabeceraApp, BarraPestanas, ErrorLiga } from "../_ui";
import { misLigas, type LigaResumen } from "@/lib/liga/api";
import { useCache } from "@/lib/liga/cache";
import { useSesionRequerida } from "../_sesion/SesionContext";
import { HojaCrear, HojaUnirse } from "./Hojas";
import { irConTransicion } from "./transicion";
import "../liga/ranking.css";
import "./privadas.css";

function Chevron() {
  return (
    <svg className="pv-chev" viewBox="0 0 8 14" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m1.5 1.5 5 5.5-5 5.5" />
    </svg>
  );
}

/** «+» de la cabecera: unirse siempre; crear, si la cuenta puede. Se ancla al botón. */
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
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
          strokeLinecap="round" aria-hidden="true">
          <path d="M12 4.5v15M4.5 12h15" />
        </svg>
      </button>
      {abierto && (
        <div className="pv-menu" role="menu">
          <button type="button" role="menuitem" onClick={() => { setAbierto(false); alUnirse(); }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M14 4h4.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H14" />
              <path d="M9 8l4 4-4 4M13 12H3" />
            </svg>
            {t("private_leagues_join_button")}
          </button>
          {puedeCrear && (
            <button type="button" role="menuitem" onClick={() => { setAbierto(false); alCrear(); }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
              {t("private_leagues_create_button")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Esqueleto con la forma del grupo de ligas: baldosa, nombre, personas y puesto. */
function EsqueletoLigas({ filas = 3 }: { filas?: number }) {
  const t = useTranslations();
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">{t("common_cargando")}</span>
      <div className="pv-grupo-lista" aria-hidden="true">
        {Array.from({ length: filas }, (_, i) => (
          <div key={i} className="pv-fila">
            <span className="esqueleto-bloque" style={{ width: 40, height: 40, borderRadius: 10 }} />
            <span className="pv-fila-t" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span className="esqueleto-bloque" style={{ width: `${58 - i * 10}%`, height: 14 }} />
              <span className="esqueleto-bloque" style={{ width: "30%", height: 12 }} />
            </span>
            <span className="esqueleto-bloque" style={{ width: 26, height: 18 }} />
            <span />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Una liga: su inicial, nombre, personas y tu puesto de la semana. Tocarla abre el detalle empujando la pantalla. */
function FilaLiga({ liga, alEntrar }: { liga: LigaResumen; alEntrar: (href: string, e: MouseEvent) => void }) {
  const t = useTranslations();
  const href = `/privadas/${liga.id}`;
  return (
    <Link href={href} className="pv-fila" onClick={(e) => alEntrar(href, e)}>
      <span className="pv-inicial" aria-hidden="true">{liga.nombre.trim().charAt(0).toLocaleUpperCase()}</span>
      <span className="pv-fila-t">
        <b>{liga.nombre}</b>
        <small>{liga.n_miembros === 1 ? t("private_leagues_only_you") : t("private_leagues_people", { count: liga.n_miembros })}</small>
      </span>
      <span className="pv-fila-p num">{liga.puesto ? t("private_leagues_place", { place: liga.puesto }) : ""}</span>
      <Chevron />
    </Link>
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

  const irA = (id: string) => { setHoja(null); irConTransicion(`/privadas/${id}`, "empuja", router); };
  // Un toque sin tecla ni botón central entra con la transición; lo demás sigue el enlace normal.
  const alEntrar = (href: string, e: MouseEvent) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    irConTransicion(href, "empuja", router);
  };

  let contenido;
  if (!sesionLista || (estado === "dentro" && !yo) || cargando) {
    contenido = <EsqueletoLigas />;
  } else if (fallo || typeof ligas === "string") {
    contenido = <ErrorLiga titulo={t("private_leagues_load_error")}
      mensaje={typeof ligas === "string" ? ligas : t("private_leagues_retry_later")}
      accion={{ texto: t("private_leagues_retry"), onClick: cargar }} />;
  } else if (ligas && ligas.length === 0) {
    contenido = (
      <div className="pv-vacio">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
          strokeLinejoin="round" aria-hidden="true">
          <circle cx="9" cy="8" r="3.2" />
          <path d="M3 19.5c0-3.2 2.7-5.5 6-5.5s6 2.3 6 5.5" />
          <path d="M16 5a3.2 3.2 0 0 1 0 6.2M17.5 14.3c2 .7 3.5 2.6 3.5 5.2" />
        </svg>
        <h2>{t("private_leagues_empty_title")}</h2>
        <p>{t("private_leagues_empty_text")}</p>
        <button type="button" className="pv-boton" onClick={() => setHoja("unirse")}>{t("private_leagues_join_button")}</button>
        {puedeCrear && (
          <button type="button" className="pv-enlace" onClick={() => setHoja("crear")}>{t("private_leagues_create_button")}</button>
        )}
      </div>
    );
  } else {
    contenido = (
      <>
        <div className="pv-grupo-lista">
          {ligas?.map((l) => <FilaLiga key={l.id} liga={l} alEntrar={alEntrar} />)}
        </div>
        <p className="pv-pie-grupo">{t("private_leagues_place_note")}</p>
      </>
    );
  }

  return (
    <main className="scroll lv-pagina pv">
      <CabeceraApp titulo={t("private_leagues_title")}
        derecha={<MenuMas puedeCrear={puedeCrear} alUnirse={() => setHoja("unirse")} alCrear={() => setHoja("crear")} />} />
      {contenido}

      <HojaUnirse abierta={hoja === "unirse"} onCerrar={() => setHoja(null)} onUnida={irA} />
      {puedeCrear && <HojaCrear abierta={hoja === "crear"} onCerrar={() => setHoja(null)} onCreada={irA} />}

      <BarraPestanas />
    </main>
  );
}
