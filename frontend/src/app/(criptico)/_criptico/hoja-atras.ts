import { useEffect, useRef } from "react";

// Al ir a otra página desde la hoja, su entrada deja de ser hoja: cerrarla no debe retroceder el historial.
export function soltarHoja(): void {
  window.history.replaceState({ ...window.history.state, cripticoHoja: false }, "");
}

// Una hoja abierta ocupa una entrada del historial: el gesto de atrás la cierra y no sale de la página.
export function useHojaAtras(abierta: boolean, cerrar: () => void): void {
  const cerrarRef = useRef(cerrar);
  useEffect(() => { cerrarRef.current = cerrar; });
  useEffect(() => {
    if (!abierta) return;
    window.history.pushState({ ...window.history.state, cripticoHoja: true }, "");
    let cerradaPorAtras = false;
    const alVolver = () => { cerradaPorAtras = true; cerrarRef.current(); };
    window.addEventListener("popstate", alVolver);
    return () => {
      window.removeEventListener("popstate", alVolver);
      if (!cerradaPorAtras && window.history.state?.cripticoHoja) window.history.back();
    };
  }, [abierta]);
}
