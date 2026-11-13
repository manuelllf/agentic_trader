"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Estrategia } from "@/lib/liga/api";
import { precargarFicha } from "@/lib/liga/ficha";
import { Escudo } from "../_ui/Escudo";

/** Lo que enseña la fila a la derecha: la píldora de resultado de quien juega. */
export type Pildora = { texto: string; clase: "bien" | "mal" | ""; etiqueta: string };

export type AccionesFila = {
  alCiclar: () => void;
  alApuntar: () => void;
  alEditar: () => void;
  alCadaMes: (opcion: "revisar" | "mantener") => void;
  alPremio: () => void;
  alQuitar: () => void;
  alBorrar: () => void;
};

const Icono = ({ d }: { d: string }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);
const ICONO_EDITAR = "M4 20h4L19 9l-4-4L4 16v4Zm9.5-13.5 4 4";
const ICONO_QUITAR = "M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17ZM8 12h8";
const ICONO_BORRAR = "M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5";
const Marca = () => (
  <span className="mi-marca"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg></span>
);

/** Una estrategia de Mías: la fila de la Liga dentro de una celda, con su menú «⋯» anclado. */
export function FilaEstrategia({ estrategia: e, sub, nuevo, pildora, ocupada, acciones }: {
  estrategia: Estrategia; sub: string; nuevo: boolean; pildora: Pildora | null; ocupada: boolean; acciones: AccionesFila;
}) {
  const t = useTranslations();
  const [abierto, setAbierto] = useState(false);
  const [arriba, setArriba] = useState(false);
  const raiz = useRef<HTMLLIElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const enJuego = e.estado === "apuntada" || e.estado === "jugando";

  useEffect(() => {
    if (!abierto) return;
    const fuera = (ev: PointerEvent) => { if (!raiz.current?.contains(ev.target as Node)) setAbierto(false); };
    const tecla = (ev: KeyboardEvent) => { if (ev.key === "Escape") setAbierto(false); };
    document.addEventListener("pointerdown", fuera);
    document.addEventListener("keydown", tecla);
    return () => { document.removeEventListener("pointerdown", fuera); document.removeEventListener("keydown", tecla); };
  }, [abierto]);
  // Si no cabe debajo (encima de la barra de pestañas), el menú se abre hacia arriba.
  useLayoutEffect(() => {
    if (!abierto) { setArriba(false); return; }
    const caja = menu.current?.getBoundingClientRect();
    if (caja && caja.bottom > window.innerHeight - 90) setArriba(true);
  }, [abierto]);

  const elegir = (fn: () => void) => () => { setAbierto(false); fn(); };

  return (
    <li className="mi-fila" ref={raiz} aria-busy={ocupada || undefined}>
      <Link href={`/ficha/${e.id}`} className="mi-abre" onPointerEnter={() => precargarFicha(e.id)}
        onPointerDown={() => precargarFicha(e.id)}>
        <Escudo valor={e.escudo} baldosa tamano={32} etiqueta={t("strategies_crest", { name: e.nombre })} />
        <span className="lv-nombre"><b>{e.nombre}</b><small className={nuevo ? "nuevo" : undefined}>{sub}</small></span>
      </Link>
      {pildora ? (
        <button type="button" className={`lv-pildora${pildora.clase ? ` ${pildora.clase}` : ""}`} onClick={acciones.alCiclar}
          aria-label={pildora.etiqueta}>{pildora.texto}</button>
      ) : e.estado === "borrador" ? (
        <button type="button" className="mi-apuntar" disabled={ocupada} onClick={acciones.alApuntar}>{t("strategies_sign_up")}</button>
      ) : <span />}
      <button type="button" className="mi-mas" aria-haspopup="menu" aria-expanded={abierto}
        aria-label={t("mias_opciones", { name: e.nombre })} onClick={() => setAbierto((a) => !a)}>
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>
      {abierto && (
        <div className={`mi-menu${arriba ? " arriba" : ""}`} role="menu" ref={menu} aria-label={t("mias_opciones", { name: e.nombre })}>
          <button type="button" role="menuitem" onClick={elegir(acciones.alEditar)}><Icono d={ICONO_EDITAR} />{t("strategies_edit")}</button>
          {e.estado !== "borrador" && <>
            <hr />
            <p className="mi-menu-cab">{t("builder_every_first_day")}</p>
            {(["revisar", "mantener"] as const).map((v) => (
              <button key={v} type="button" role="menuitemradio" aria-checked={e.cada_dia_1 === v} disabled={ocupada}
                onClick={elegir(() => acciones.alCadaMes(v))}>
                <Marca />{t(v === "revisar" ? "builder_review_strategy" : "builder_keep_strategy")}
              </button>
            ))}
          </>}
          {enJuego && <>
            <hr />
            <button type="button" role="menuitemcheckbox" aria-checked={e.opta_premio} disabled={ocupada || e.opta_premio}
              onClick={elegir(acciones.alPremio)}><Marca />{t("mias_opta_premio")}</button>
          </>}
          {e.estado === "apuntada" && <>
            <hr />
            <button type="button" role="menuitem" className="peligro" disabled={ocupada} onClick={elegir(acciones.alQuitar)}>
              <Icono d={ICONO_QUITAR} />{t("strategies_remove_from_round")}</button>
          </>}
          {e.estado === "borrador" && <>
            <hr />
            <button type="button" role="menuitem" className="peligro" disabled={ocupada} onClick={elegir(acciones.alBorrar)}>
              <Icono d={ICONO_BORRAR} />{t("strategies_delete")}</button>
          </>}
        </div>
      )}
    </li>
  );
}
