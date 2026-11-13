"use client";

// Cabecera de la ficha (maqueta `cabeceraFicha`): atrás con el nombre de donde se vino, el nombre al bajar
// y a la derecha Editar (si es tuya) o el menú de tres puntos.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { leerVolver } from "@/lib/liga/volver";

type Props = {
  nombre: string; idEstrategia: string; esDueno: boolean; puedeCopiar: boolean; ocupado: boolean;
  onCopiar: () => void; onReportar: () => void;
  /** Mientras carga la ficha: solo el chevron de volver. */
  sinAcciones?: boolean;
};

const ICONO_COPIAR = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
    <path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" />
  </svg>
);
const ICONO_REPORTAR = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5.5 21V4.5M5.5 4.5h11l-2.5 4 2.5 4h-11" />
  </svg>
);

export function CabeceraFicha({ nombre, idEstrategia, esDueno, puedeCopiar, ocupado, onCopiar, onReportar, sinAcciones = false }: Props) {
  const t = useTranslations();
  const router = useRouter();
  const [volver, setVolver] = useState<{ texto: string; ruta: string } | null>(null);
  const [abierto, setAbierto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);

  // sessionStorage solo existe en el navegador: se lee tras hidratar para no desajustar el marcado.
  useEffect(() => { setVolver(leerVolver(idEstrategia)); }, [idEstrategia]);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (ev: PointerEvent) => { if (!raiz.current?.contains(ev.target as Node)) setAbierto(false); };
    const tecla = (ev: KeyboardEvent) => { if (ev.key === "Escape") setAbierto(false); };
    document.addEventListener("pointerdown", fuera);
    document.addEventListener("keydown", tecla);
    return () => { document.removeEventListener("pointerdown", fuera); document.removeEventListener("keydown", tecla); };
  }, [abierto]);

  const destino = volver?.texto ?? t("ficha_volver_liga");
  const atras = () => {
    if (window.history.length > 1) router.back();
    else router.push(volver?.ruta ?? "/liga");
  };
  const elegir = (fn: () => void) => () => { setAbierto(false); fn(); };
  const etiquetaOpciones = t("ficha_opciones", { name: nombre });

  return (
    <header className="cab centrada">
      <button type="button" className="fi-atras" aria-label={t("ficha_volver_aria", { destino })} onClick={atras}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 5l-7 7 7 7" />
        </svg>
        <span>{destino}</span>
      </button>
      <h1 className="cab-titulo">{nombre}</h1>
      <div className="cab-der">
        {sinAcciones ? null : esDueno ? (
          <Link className="fi-accion" href={`/crear/${idEstrategia}`}>{t("strategies_edit")}</Link>
        ) : (
          <div className="fi-menu-raiz" ref={raiz}>
            <button type="button" className="fi-mas" aria-haspopup="menu" aria-expanded={abierto}
              aria-label={etiquetaOpciones} onClick={() => setAbierto((a) => !a)}>
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
              </svg>
            </button>
            {abierto && (
              <div className="fi-menu" role="menu" aria-label={etiquetaOpciones}>
                {puedeCopiar && (
                  <button type="button" role="menuitem" disabled={ocupado} onClick={elegir(onCopiar)}>
                    {ICONO_COPIAR}{t("strategies_copy_adjust")}
                  </button>
                )}
                <button type="button" role="menuitem" disabled={ocupado} onClick={elegir(onReportar)}>
                  {ICONO_REPORTAR}{t("strategies_report")}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
