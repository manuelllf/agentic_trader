// Las guías de /aprender, en orden. La del premio solo existe si el premio se enseña.
export const GUIAS = [
  { slug: "que-es-la-liga", clave: "g1", minutos: 2, premio: false },
  { slug: "crear-tu-estrategia", clave: "g2", minutos: 3, premio: false },
  { slug: "que-pasa-al-cierre", clave: "g3", minutos: 2, premio: false },
  { slug: "leer-la-clasificacion", clave: "g4", minutos: 2, premio: false },
  { slug: "el-premio", clave: "g5", minutos: 1, premio: true },
] as const;

export type Guia = (typeof GUIAS)[number];

export function guiasVisibles(premioVisible: boolean): Guia[] {
  return GUIAS.filter(g => !g.premio || premioVisible);
}
