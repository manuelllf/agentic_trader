"use client";

// Red de seguridad de las salas de admin: si una pantalla falla al pintarse, se ve qué pasó y
// hay salida, en vez de una página en blanco.

import Link from "next/link";
import { useEffect } from "react";

export default function ErrorAdmin({ error, reset }: {
  error: Error & { digest?: string }; reset: () => void;
}) {
  useEffect(() => { console.error(error); }, [error]);

  return (
    <main className="mx-auto max-w-md px-4 pb-16 pt-10 text-[13px]" style={{ color: "#c3c2b7" }}>
      <h1 className="text-[19px] text-white"
          style={{ fontFamily: "var(--font-land-serif)", fontStyle: "italic" }}>
        Algo ha fallado
      </h1>
      <p className="mt-3 rounded-lg p-3" style={{ background: "#2a1616", color: "#e66767" }}>
        {error.message || "Error al mostrar esta pantalla."}
        {error.digest ? ` (${error.digest})` : ""}
      </p>
      <button type="button" onClick={reset}
              className="mt-4 min-h-[44px] w-full rounded-lg px-4 font-bold text-white"
              style={{ background: "#3987e5" }}>
        Reintentar
      </button>
      <Link href="/admin" className="mt-2 flex min-h-[44px] w-full items-center justify-center rounded-lg px-4"
            style={{ background: "#2c2c2a", color: "#c3c2b7" }}>
        Volver a las salas
      </Link>
    </main>
  );
}
