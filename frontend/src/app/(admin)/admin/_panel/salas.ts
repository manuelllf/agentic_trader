// Salas del panel durante la convivencia y secciones de Vennett, en el orden de la maqueta.
// Los iconos son datos (no JSX) para poder probar este módulo sin renderizar.

export type Forma =
  | { tipo: "trazo"; d: string }
  | { tipo: "relleno"; x: number; y: number; ancho: number; alto: number; radio: number }
  | { tipo: "circulo"; cx: number; cy: number; r: number; lleno?: boolean };

export type ClaveSala = "vennett" | "alpha" | "beta" | "omega" | "alphagentic";

export interface Sala {
  clave: ClaveSala;
  href: string;
  icono: Forma[];
}

export const SALAS: readonly Sala[] = [
  { clave: "vennett", href: "/admin", icono: [
    { tipo: "trazo", d: "M6.5 6.5V18a2 2 0 0 0 2 2H11" },
    { tipo: "relleno", x: 4, y: 9.5, ancho: 5, alto: 5, radio: 1 },
    { tipo: "trazo", d: "M15 3v15a2 2 0 0 0 2 2h3" },
    { tipo: "relleno", x: 12.5, y: 5, ancho: 5, alto: 5, radio: 1 },
  ] },
  { clave: "alpha", href: "/admin/alpha", icono: [
    { tipo: "trazo", d: "M18.5 6.5c-.9 5.6-3.7 11-8 11-3 0-5-2.3-5-5.5s2-5.5 5-5.5c4.3 0 7.1 5.4 8 11" },
  ] },
  { clave: "beta", href: "/admin/beta", icono: [
    { tipo: "trazo", d: "M8 20.5V8.5a4.5 4.5 0 0 1 9 0c0 2.4-1.8 3.8-4 3.8h-1.5" },
    { tipo: "trazo", d: "M11.5 12.3c2.7 0 5 1.5 5 3.9 0 2.3-2 3.8-4.3 3.8-1.6 0-3-.6-4.2-1.7" },
  ] },
  { clave: "omega", href: "/admin/omega", icono: [
    { tipo: "trazo", d: "M7.5 7C5.3 8.4 4 10.6 4 13.2 4 16 5.6 17.5 7.7 17.5c2 0 3.5-1.6 4.3-4.5.8 2.9 2.3 4.5 4.3 4.5 2.1 0 3.7-1.5 3.7-4.3 0-2.6-1.3-4.8-3.5-6.2" },
    { tipo: "trazo", d: "M12 10v3" },
  ] },
  // Icono provisional hasta el retiro, cuando Alphagentic hereda el nombre y la α de Alpha.
  { clave: "alphagentic", href: "/admin/agente", icono: [
    { tipo: "circulo", cx: 12, cy: 12, r: 8 },
    { tipo: "circulo", cx: 12, cy: 12, r: 1.6 },
  ] },
];

export type ClaveSeccion =
  | "jornadas" | "premio" | "usuarios" | "consultas" | "analitica" | "boletin" | "revisar"
  | "datos" | "coste" | "ajustes" | "auditoria" | "archivo";

export interface Seccion {
  clave: ClaveSeccion;
  href: string;
  /** La ruta aún no existe: se lista, pero no se enlaza. */
  pronto?: boolean;
}

export interface GrupoSecciones {
  clave: "liga" | "personas" | "contenido" | "sistema";
  secciones: readonly Seccion[];
}

export const GRUPOS_SECCIONES: readonly GrupoSecciones[] = [
  { clave: "liga", secciones: [
    { clave: "jornadas", href: "/admin/liga/jornadas" },
    { clave: "premio", href: "/admin/liga/premio" },
  ] },
  { clave: "personas", secciones: [
    { clave: "usuarios", href: "/admin/liga/usuarios" },
    { clave: "consultas", href: "/admin/liga/consultas" },
    { clave: "analitica", href: "/admin/liga/analitica" },
  ] },
  { clave: "contenido", secciones: [
    { clave: "boletin", href: "/admin/blog" },
    { clave: "revisar", href: "/admin/liga/revisar" },
  ] },
  { clave: "sistema", secciones: [
    { clave: "datos", href: "/admin/datos" },
    { clave: "coste", href: "/admin/liga/coste-ia" },
    { clave: "ajustes", href: "/admin/liga/ajustes" },
    { clave: "auditoria", href: "/admin/liga/auditoria" },
    { clave: "archivo", href: "/admin/archivo", pronto: true },
  ] },
];

export const SECCIONES: readonly Seccion[] = GRUPOS_SECCIONES.flatMap(g => g.secciones);

const dentro = (ruta: string, base: string) => ruta === base || ruta.startsWith(`${base}/`);
const limpia = (ruta: string) => (ruta.length > 1 ? ruta.replace(/\/+$/, "") : ruta);

export function salaDe(ruta: string): ClaveSala {
  const r = limpia(ruta);
  for (const sala of SALAS) if (sala.clave !== "vennett" && dentro(r, sala.href)) return sala.clave;
  return "vennett";
}

export function seccionDe(ruta: string): ClaveSeccion | null {
  const r = limpia(ruta);
  return SECCIONES.find(s => dentro(r, s.href))?.clave ?? null;
}

/** Vennett tiene padre (el inicio) en toda ruta menos en el propio inicio. */
export function tienePadre(ruta: string): boolean {
  return salaDe(ruta) === "vennett" && limpia(ruta) !== "/admin";
}

/** Pantallas ya rehechas con el kit nuevo; el resto se ven aún con su aspecto oscuro de siempre. */
// Solo la Alpha antigua y Beta conservan su aspecto: se retiran y no se rehacen (D1).
export function esPantallaNueva(ruta: string): boolean {
  const r = limpia(ruta);
  return !["/admin/alpha", "/admin/beta"].some((v) => r === v || r.startsWith(`${v}/`));
}
