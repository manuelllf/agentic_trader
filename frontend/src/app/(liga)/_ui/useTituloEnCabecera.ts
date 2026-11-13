import { useEffect, type RefObject } from "react";

/** Como en la maqueta: al subir, el título grande sale de la cabecera y esta enseña «Liga». */
export function useTituloEnCabecera(titulo: RefObject<HTMLHeadingElement | null>) {
  useEffect(() => {
    const raiz = document.documentElement;
    const marcar = () => {
      const cab = document.querySelector(".lg .cab");
      if (titulo.current && cab) {
        raiz.toggleAttribute("data-titulo", titulo.current.getBoundingClientRect().bottom < cab.getBoundingClientRect().bottom);
      }
    };
    marcar();
    addEventListener("scroll", marcar, { passive: true });
    return () => {
      removeEventListener("scroll", marcar);
      raiz.removeAttribute("data-titulo");
    };
  }, [titulo]);
}
