"use client";

// Portada sin sesión (brief de Manuel, 27-sep): una sola pantalla, sin scroll, sin héroe de IA
// slop. El centro es una frase que se compone tocando chips (tamaño/finanzas/calidad de negocio,
// sacadas del catálogo real de reglas — `GET /liga/catalogo`, copia estática si falla) y un
// escudo que se redibuja según lo elegido. Con sesión, no se enseña nada de esto: se redirige a
// /liga en cuanto se sabe (sin parpadeo de la portada).

import Link from "next/link";
import { useMemo, useState } from "react";
import { CASA, Escudo, PALETA, escudoCasa, type DibujoEscudo, type EscudoValor, type FormaEscudo } from "./_ui";
import { getCatalogo, type Catalogo } from "@/lib/liga/api";
import { useCache } from "@/lib/liga/cache";
import { useRedirigirSiHaySesion } from "./_sesion/SesionContext";

type Opcion = { clave: string; frase: string };

// Cada frase corresponde 1:1 a una regla real del motor (`backend/app/liga/motor/catalogo.py`):
// es copia escrita a mano, no un dato, así que sigue sirviendo si el catálogo no responde.
const TAMANOS: Opcion[] = [
  { clave: "pequenas", frase: "pequeñas" },
  { clave: "medianas", frase: "medianas" },
  { clave: "grandes", frase: "grandes" },
];
const FINANZAS: Opcion[] = [
  { clave: "deuda", frase: "que no deben casi nada" },
  { clave: "caja_neta", frase: "que tienen más caja que deuda" },
  { clave: "barata", frase: "que no están caras" },
  { clave: "dividendo", frase: "que reparten dividendo" },
];
const CALIDAD: Opcion[] = [
  { clave: "crecen", frase: "y crecen cada año" },
  { clave: "margen", frase: "y ganan con buen margen" },
  { clave: "rentables", frase: "y son muy rentables" },
  { clave: "castigadas", frase: "y están castigadas ahora" },
];

const FORMAS: FormaEscudo[] = ["circulo", "escudo", "hexagono"];
// Sin "liso": el escudo del jugador siempre lleva dibujo de dos colores, nunca un círculo plano
// (brief 27-sep), incluso en el estado inicial (a=b=c=0).
const DIBUJOS: DibujoEscudo[] = ["mitades", "diagonal", "franja"];
const NOM1 = ["Foso", "Cauce", "Terreno", "Rumbo", "Margen", "Cierre", "Suelo", "Puerto"];
const NOM2 = ["ancho", "firme", "limpio", "curtido", "sereno", "corto", "fértil", "seguro"];

/** Solo las opciones cuya clave sigue en el catálogo real; si no hay catálogo o no queda ninguna,
 *  la lista escrita a mano entera (copia, no dato: nunca se rompe por esto). */
function vivas(opciones: Opcion[], claves: Set<string> | null): Opcion[] {
  if (!claves) return opciones;
  const f = opciones.filter((o) => claves.has(o.clave));
  return f.length > 0 ? f : opciones;
}

export default function Portada() {
  const sesion = useRedirigirSiHaySesion();
  const { datos: catalogoDatos } = useCache<Catalogo | string>("catalogo", getCatalogo);
  const catalogo = catalogoDatos && typeof catalogoDatos === "object" ? catalogoDatos : null;
  const [a, setA] = useState(0);
  const [b, setB] = useState(0);
  const [c, setC] = useState(0);
  const [tocado, setTocado] = useState(false);

  const claves = useMemo(
    () => (catalogo ? new Set(catalogo.reglas.map((r) => r.clave)) : null),
    [catalogo],
  );
  const tamanos = useMemo(() => vivas(TAMANOS, claves), [claves]);
  const finanzas = useMemo(() => vivas(FINANZAS, claves), [claves]);
  const calidad = useMemo(() => vivas(CALIDAD, claves), [claves]);

  const ai = a % tamanos.length;
  const bi = b % finanzas.length;
  const ci = c % calidad.length;
  const opTamano = tamanos[ai];
  const opFinanzas = finanzas[bi];
  const opCalidad = calidad[ci];

  const nombre = `${NOM1[(ai * 4 + bi) % NOM1.length]} ${NOM2[(bi * 4 + ci) % NOM2.length]}`;

  const escudo: EscudoValor = useMemo(() => {
    const color1 = PALETA[(ai * 7 + bi * 3 + ci) % PALETA.length];
    let color2 = PALETA[(ai * 2 + bi * 5 + ci * 7 + 6) % PALETA.length];
    if (color2 === color1) color2 = PALETA[(PALETA.indexOf(color2) + 1) % PALETA.length];
    return {
      forma: FORMAS[ai % FORMAS.length],
      dibujo: DIBUJOS[bi % DIBUJOS.length],
      color1,
      color2,
      iniciales: `${nombre[0]}${nombre.split(" ")[1]?.[0] ?? ""}`.toUpperCase(),
    };
  }, [ai, bi, ci, nombre]);

  const tocar = (fn: () => void) => () => { fn(); setTocado(true); };

  // Con sesión (o mientras se sabe) no se enseña nada: así no hay parpadeo de la portada antes
  // del salto a /liga.
  if (sesion !== "fuera") return null;

  return (
    <main className="land">
      <header className="land-top land-in" style={{ ["--d" as string]: "0ms" }}>
        <span className="wordmark">liguilla</span>
        <Link href="/entrar" className="btn discreto small">Entrar</Link>
      </header>

      <div className="land-mid">
        <p className="land-frase land-in" style={{ ["--d" as string]: "80ms" }}>
          Empresas{" "}
          <button
            type="button"
            className={`land-chip${!tocado ? " hint" : ""}`}
            onClick={tocar(() => setA((v) => v + 1))}
            aria-label={`Tamaño: empresas ${opTamano.frase}. Toca para probar otro tamaño.`}
          >
            {opTamano.frase}
          </button>{" "}
          <button
            type="button"
            className="land-chip"
            onClick={tocar(() => setB((v) => v + 1))}
            aria-label={`Finanzas: ${opFinanzas.frase}. Toca para probar otra condición.`}
          >
            {opFinanzas.frase}
          </button>{" "}
          <button
            type="button"
            className="land-chip"
            onClick={tocar(() => setC((v) => v + 1))}
            aria-label={`Calidad del negocio: ${opCalidad.frase}. Toca para probar otra.`}
          >
            {opCalidad.frase}
          </button>
        </p>

        <div className="land-crest land-in" style={{ ["--d" as string]: "200ms" }}>
          <div className="land-crest-pop" key={`${ai}-${bi}-${ci}`}>
            <Escudo valor={escudo} etiqueta={`Escudo de ${nombre}`} tamano={96} />
          </div>
          <p className="land-nombre">{nombre}</p>
        </div>

        <div className="land-vs land-in" style={{ ["--d" as string]: "340ms" }}>
          <Escudo valor={escudo} etiqueta={`Escudo de ${nombre}`} tamano={34} />
          <span className="land-vs-x">contra</span>
          <span className="land-sp">el S&amp;P 500</span>
          <span className="land-rivales" aria-hidden="true">
            <Escudo valor={escudoCasa("alpha")} etiqueta="Alpha" tamano={22} />
            <Escudo valor={escudoCasa("omega")} etiqueta="Omega" tamano={22} />
            <Escudo valor={escudoCasa("lambda")} etiqueta="Lambda" tamano={22} />
          </span>
          <span className="sr-only">
            y también contra las estrategias de la casa: {CASA.alpha.nombre}, {CASA.omega.nombre} y{" "}
            {CASA.lambda.nombre}.
          </span>
        </div>

        <p className="land-reglas land-in" style={{ ["--d" as string]: "460ms" }}>
          Cada mes: <b>3</b> puntos si le ganas al S&amp;P por más de medio punto, <b>1</b> si empatas,{" "}
          <b>0</b> si pierdes.
        </p>
      </div>

      <div className="land-cta land-in" style={{ ["--d" as string]: "560ms" }}>
        <Link href="/entrar?next=/crear" className="btn pri wide">Crea la tuya</Link>
        <Link href="/liga" className="btn discreto">Ver la liga</Link>
      </div>

      <p className="land-legal land-in" style={{ ["--d" as string]: "620ms" }}>
        <Link href="/legal/privacidad">Privacidad</Link>
        <Link href="/legal/terminos">Términos</Link>
        <Link href="/legal/cookies">Cookies</Link>
      </p>
    </main>
  );
}
