// Las secciones de Vennett y las salas del admin, en el orden del menú.
export const SECCIONES = [
  { clave: "resumen", href: "/admin/liga", exacta: true },
  { clave: "analitica", href: "/admin/liga/analitica" },
  { clave: "jornadas", href: "/admin/liga/jornadas" },
  { clave: "usuarios", href: "/admin/liga/usuarios" },
  { clave: "consultas", href: "/admin/liga/consultas" },
  { clave: "coste", href: "/admin/liga/coste-ia" },
  { clave: "revisar", href: "/admin/liga/revisar" },
  { clave: "premio", href: "/admin/liga/premio" },
  { clave: "ajustes", href: "/admin/liga/ajustes" },
  { clave: "auditoria", href: "/admin/liga/auditoria" },
  { clave: "blog", href: "/admin/blog" },
] as const;

export const SALAS = [
  { clave: "vennett", nombre: "Vennett", href: "/admin/liga" },
  { clave: "alpha", nombre: "Alpha", href: "/admin/alpha" },
  { clave: "beta", nombre: "Beta", href: "/admin/beta" },
  { clave: "omega", nombre: "Omega", href: "/admin/omega" },
] as const;

export type ClaveSeccion = (typeof SECCIONES)[number]["clave"];

export function salaDe(ruta: string): (typeof SALAS)[number]["clave"] {
  for (const s of ["alpha", "beta", "omega"] as const) if (ruta.startsWith(`/admin/${s}`)) return s;
  return "vennett";
}

export function seccionDe(ruta: string): ClaveSeccion | null {
  for (const s of SECCIONES) {
    if ("exacta" in s ? ruta === s.href : ruta === s.href || ruta.startsWith(`${s.href}/`)) return s.clave;
  }
  return null;
}
