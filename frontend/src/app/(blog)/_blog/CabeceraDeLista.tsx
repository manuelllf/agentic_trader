"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

// Título grande que se contrae en la barra al hacer scroll (DESIGN §6). Sin JS la barra se queda igual.
export function CabeceraDeLista({ titulo, izquierda, derecha }: { titulo: string; izquierda: ReactNode; derecha: ReactNode }) {
  const [contraida, setContraida] = useState(false);
  const grande = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const destino = grande.current;
    if (!destino || typeof IntersectionObserver === "undefined") return;
    const observador = new IntersectionObserver(([entrada]) => setContraida(!entrada.isIntersecting), { rootMargin: "-56px 0px 0px 0px" });
    observador.observe(destino);
    return () => observador.disconnect();
  }, []);
  return <>
    <header className="blog-header" data-contraida={contraida}>
      {izquierda}
      <span className="blog-titulo-contraido" aria-hidden="true">{titulo}</span>
      {derecha}
    </header>
    <h1 ref={grande} className="blog-titulo-grande">{titulo}</h1>
  </>;
}
