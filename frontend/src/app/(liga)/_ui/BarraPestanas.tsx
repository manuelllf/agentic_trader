"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// `.tabbar` de la maqueta (DESIGN.md §5 y §6): Liga, Privadas, Crear y Mías, iconos de trazo
// en línea (nada de librería de iconos).
const PESTANAS = [
  {
    href: "/", clave: "liga", texto: "Liga",
    icono: <path d="M3 20h18M5 20v-6h4v6M10 20V8h4v12M15 20v-9h4v9" />,
  },
  {
    href: "/privadas", clave: "privadas", texto: "Privadas",
    icono: (
      <>
        <circle cx="9" cy="8" r="3.2" />
        <path d="M3 19.5c0-3.2 2.7-5.5 6-5.5s6 2.3 6 5.5" />
        <path d="M16 5a3.2 3.2 0 0 1 0 6.2M17.5 14.3c2 .7 3.5 2.6 3.5 5.2" />
      </>
    ),
  },
  {
    href: "/crear", clave: "crear", texto: "Crear",
    icono: <><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></>,
  },
  {
    href: "/mias", clave: "mias", texto: "Mías",
    icono: (
      <>
        <path d="M12 3.5l8.5 4.6L12 12.7 3.5 8.1z" />
        <path d="M3.5 12.4L12 17l8.5-4.6M3.5 16.4L12 21l8.5-4.6" />
      </>
    ),
  },
] as const;

export function BarraPestanas() {
  const ruta = usePathname();
  return (
    <nav className="tabbar" aria-label="Secciones">
      {PESTANAS.map((p) => {
        const activa = p.clave === "crear" ? ruta?.startsWith("/crear")
          : p.clave === "mias" ? ruta?.startsWith("/mias")
          : p.clave === "privadas" ? ruta?.startsWith("/privadas")
          : p.clave === "liga" ? (ruta === "/" || ruta?.startsWith("/ficha"))
          : false;
        return (
          <Link key={p.clave} href={p.href} aria-current={activa ? "page" : undefined}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9}
                 strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {p.icono}
            </svg>
            <span>{p.texto}</span>
          </Link>
        );
      })}
    </nav>
  );
}
