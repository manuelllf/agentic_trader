export type Idioma = "es" | "en";
export type Papel = "def" | "ind" | "mat";
export type Ayuda = Papel | "letra";
export type Segmento = { texto: string; papel: Papel | null };
export type Acertijo = {
  id: number;
  idioma: Idioma;
  numero: number;
  fecha: string;
  nivel: "facil" | "media" | "dificil";
  pista: Segmento[];
  longitud: number;
  ayudas: Record<Papel, string>;
  media: number | null;
  n_media: number | null;
};
export type Detalle = {
  respuesta: string;
  palabra: string;
  resolucion: string;
  concepto: string;
  ejemplo: string;
  regla_catalogo: string | null;
};
export type Entrega = { acertijo: Acertijo; solucion?: Detalle };
export type Textos = Record<string, string>;
export type Traducir = (clave: string, valores?: Record<string, string | number>) => string;
