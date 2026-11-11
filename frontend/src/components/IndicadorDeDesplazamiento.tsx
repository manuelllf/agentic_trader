"use client";

import { useEffect, useRef } from "react";

// Como en iOS: la barra de desplazamiento aparece mientras la página se mueve y se desvanece después.
// La cabecera recibe material cuando la marca del inicio sale de la vista, es decir, cuando hay contenido debajo.
export default function IndicadorDeDesplazamiento() {
  const marca = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const observador = new IntersectionObserver(([entrada]) => {
      document.documentElement.toggleAttribute("data-superado", !entrada.isIntersecting);
    });
    if (marca.current) observador.observe(marca.current);
    let temporizador: number | undefined;
    const alDesplazar = () => {
      document.documentElement.setAttribute("data-desplazando", "");
      window.clearTimeout(temporizador);
      temporizador = window.setTimeout(() => document.documentElement.removeAttribute("data-desplazando"), 900);
    };
    window.addEventListener("scroll", alDesplazar, { passive: true });
    return () => {
      observador.disconnect();
      window.removeEventListener("scroll", alDesplazar);
      window.clearTimeout(temporizador);
    };
  }, []);
  return <span ref={marca} aria-hidden="true" style={{ position: "absolute", top: 0, left: 0, width: 1, height: 1, pointerEvents: "none" }} />;
}
