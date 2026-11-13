"use client";

// Cuenta en el móvil: una hoja alta desde «⋯», como la cuenta de la App Store. «Listo» la cierra y, dentro, cada
// pantalla empuja con «‹ Cuenta». En escritorio no se usa: allí Cuenta es una pestaña (PaginaCuenta).

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useConfirmar } from "@/components/Confirmar";
import { useSesion } from "../_sesion/SesionContext";
import { ErrorLiga } from "../_ui/ErrorLiga";
import { AvisoCuenta, BarraCuenta, CuerpoCuenta, EsqueletoCuenta, ProveedorNavCuenta, TITULOS, type NavCuenta, type Pantalla } from "./marco";
import { PANTALLAS } from "./pantallas";
import { ContextoHojaCuenta } from "./hojaContexto";
import "../_ui/hoja.css";
import "../liga/ranking.css";
import "./cuenta.css";

export { cuentaEnHoja, useHojaCuenta } from "./hojaContexto";

const UMBRAL_CIERRE = 90;

export function ProveedorHojaCuenta({ children }: { children: ReactNode }) {
  const t = useTranslations();
  const { yo, yoFallo, refrescarYo } = useSesion();
  const { confirmar, dialogo } = useConfirmar();
  const pathname = usePathname();
  const [pila, setPila] = useState<Pantalla[] | null>(null);
  const [animacion, setAnimacion] = useState<NavCuenta["animacion"]>("");
  const [cerrando, setCerrando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const cambios = useRef(false);
  const dialogoRef = useRef<HTMLDialogElement>(null);
  const cuerpo = useRef<HTMLDivElement>(null);
  const arrastre = useRef<{ y: number; dy: number } | null>(null);

  const abrir = useCallback((p?: Pantalla) => {
    cambios.current = false;
    setAnimacion("");
    setCerrando(false);
    setPila(p && p !== "inicio" ? ["inicio", p] : ["inicio"]);
  }, []);
  const cerrarYa = useCallback(() => {
    cambios.current = false;
    setCerrando(true);
    window.setTimeout(() => { setPila(null); setCerrando(false); }, 280);
  }, []);
  const cerrar = useCallback(async () => {
    if (cambios.current) {
      const descartar = await confirmar({ titulo: t("account_descartar_titulo"), texto: t("account_descartar_texto"),
        aceptar: t("account_descartar"), peligro: true });
      if (!descartar) {
        if (cuerpo.current) cuerpo.current.style.transform = "";
        return;
      }
    }
    cerrarYa();
  }, [confirmar, cerrarYa, t]);

  // Salir de Cuenta por un enlace (cómo funciona, legal…) cierra la hoja.
  const rutaAbierta = useRef(pathname);
  useEffect(() => {
    if (pathname !== rutaAbierta.current) { rutaAbierta.current = pathname; setPila(null); }
  }, [pathname]);

  const abierta = pila !== null;
  useEffect(() => {
    const d = dialogoRef.current;
    if (abierta && d && !d.open) d.showModal();
  }, [abierta]);

  const marcarCambios = useCallback((hay: boolean) => { cambios.current = hay; }, []);
  const sinAviso = useCallback(() => setAviso(null), []);
  const nav = useMemo<NavCuenta>(() => ({
    modo: "hoja", hondo: (pila?.length ?? 0) > 1, animacion,
    ir: (p) => { setAnimacion("cu-entra"); setPila((s) => (s ? [...s, p] : [p])); },
    volver: () => { cambios.current = false; setAnimacion("cu-vuelve"); setPila((s) => (s && s.length > 1 ? s.slice(0, -1) : s)); },
    cerrar: () => { void cerrar(); },
    avisar: setAviso,
    marcarCambios,
  }), [pila, animacion, cerrar, marcarCambios]);

  const bajar = (e: PointerEvent<HTMLDivElement>) => {
    arrastre.current = { y: e.clientY, dy: 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
    if (cuerpo.current) cuerpo.current.style.transition = "none";
  };
  const mover = (e: PointerEvent<HTMLDivElement>) => {
    const a = arrastre.current;
    if (!a || !cuerpo.current) return;
    a.dy = Math.max(0, e.clientY - a.y);
    cuerpo.current.style.transform = `translateY(${a.dy}px)`;
  };
  const soltar = () => {
    const a = arrastre.current;
    arrastre.current = null;
    if (!a || !cuerpo.current) return;
    cuerpo.current.style.transition = "";
    if (a.dy > UMBRAL_CIERRE) void cerrar();
    else cuerpo.current.style.transform = "";
  };

  const actual = pila?.[pila.length - 1] ?? "inicio";
  const Contenido = PANTALLAS[actual];
  const valor = useMemo(() => ({ abrir }), [abrir]);

  return <ContextoHojaCuenta.Provider value={valor}>
    {children}
    {abierta && <dialog ref={dialogoRef} className="hoja-liga cu-hoja lv-pagina" aria-labelledby="cu-hoja-titulo"
      onCancel={(e) => { e.preventDefault(); void cerrar(); }}
      onClick={(e) => { if (e.target === dialogoRef.current) void cerrar(); }}>
      <div className="hoja-liga-cuerpo" ref={cuerpo} style={cerrando
        ? { transition: "transform .3s cubic-bezier(.32,.72,0,1)", transform: "translateY(100%)" } : undefined}>
        <div className="hoja-liga-agarre" onPointerDown={bajar} onPointerMove={mover} onPointerUp={soltar} onPointerCancel={soltar}>
          <span className="hoja-liga-asa" aria-hidden="true" />
        </div>
        <ProveedorNavCuenta value={nav}>
          {yo ? <Contenido key={`${pila.length}-${actual}`} /> : <>
            <BarraCuenta titulo={t(TITULOS[actual])} />
            <CuerpoCuenta>{yoFallo
              ? <ErrorLiga titulo={t("account_error_cargar")} mensaje={t("account_error_reintentar")}
                accion={{ texto: t("account_reintentar"), onClick: refrescarYo }} />
              : <EsqueletoCuenta />}</CuerpoCuenta>
          </>}
        </ProveedorNavCuenta>
      </div>
      <AvisoCuenta texto={aviso} onFin={sinAviso} />
      {dialogo}
    </dialog>}
    {!abierta && dialogo}
  </ContextoHojaCuenta.Provider>;
}
