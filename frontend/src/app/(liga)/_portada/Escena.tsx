import type { CSSProperties } from "react";
import { Escudo } from "../_ui";
import { signo } from "@/lib/liga/format";
import { MESES, SP, puntos, puntosTotales, tablaDe, type Idea } from "./ideas";

// Todo el movimiento es CSS con retardos (`--d`): sin temporizadores, y con «reducir movimiento»
// se ve directamente el estado final. Un `key` distinto en el padre la vuelve a jugar.
const retraso = (segundos: number) => ({ ["--d" as string]: `${segundos}s` }) as CSSProperties;
const MES_LARGO = ["abril", "mayo", "junio", "julio", "agosto", "septiembre"];

export function Escena({ idea }: { idea: Idea }) {
  const total = puntosTotales(idea);
  const tabla = tablaDe(idea);
  const puesto = tabla.findIndex((f) => f.mia) + 1;

  return (
    <div className="lnd-esc">
      <section className="lnd-b" aria-label="Tu idea">
        <p className="lnd-frase">
          {idea.frases.map((f, i) => (
            <span key={f} className="lnd-chip" style={retraso(0.15 + i * 0.4)}>{f}</span>
          ))}
        </p>
        <div className="lnd-escudo lnd-pop" style={retraso(1.3)}>
          <Escudo valor={idea.escudo} etiqueta={`Escudo de ${idea.nombre}`} tamano={64} />
          <b>{idea.nombre}</b>
        </div>
      </section>

      <section className="lnd-b" aria-label="Sus empresas">
        <h2 className="lnd-lab">
          <span className="lnd-lab-a">El motor elige. Tú ves por qué</span>
          <span className="lnd-lab-b">5 empresas, cada una con su porqué</span>
        </h2>
        <ul className="lnd-emp">
          {idea.empresas.map((e, i) => (
            <li key={e.nombre} className="lnd-a" style={retraso(1.9 + i * 0.45)}>
              <span className="lnd-emp-n">{e.nombre}</span>
              <span className="lnd-emp-p" style={retraso(2.05 + i * 0.45)}>{e.porque}</span>
              <b className="lnd-emp-w">{e.peso} %</b>
            </li>
          ))}
        </ul>
      </section>

      <section className="lnd-b lnd-mes-b" aria-label="Cómo se comporta">
        <h2 className="lnd-lab">
          Seis meses contra el S&amp;P 500 <span className="lnd-ej">Ejemplo</span>
        </h2>
        <ol className="lnd-meses">
          {MESES.map((m, j) => {
            const p = puntos(idea.tu[j], SP[j]);
            return (
              <li key={m} className={`lnd-mes r${p}`} style={{ ["--j" as string]: j } as CSSProperties}>
                <span className="lnd-mes-m" aria-hidden="true">{m}</span>
                <b className="lnd-mes-d" aria-hidden="true">{signo(idea.tu[j] - SP[j])}</b>
                <i className="lnd-mes-p" aria-hidden="true">{p}</i>
                <span className="sr-only">
                  {`${MES_LARGO[j]}: ${signo(idea.tu[j])} % frente a ${signo(SP[j])} % del S&P 500, ${p} ${p === 1 ? "punto" : "puntos"}`}
                </span>
              </li>
            );
          })}
        </ol>
        <p className="lnd-nota lnd-tarde-1">Diferencia con el S&amp;P cada mes y puntos que suma</p>
        <p className="lnd-conclusion lnd-tarde-1">{idea.conclusion}</p>

        <p className="lnd-puesto lnd-tarde-2">
          <b>{total} puntos</b> · puesto {puesto} en la tabla de ejemplo
        </p>
        <ol className="lnd-tabla lnd-tarde-2" aria-label="Clasificación de ejemplo">
          {tabla.map((f, i) => (
            <li key={f.nombre} className={f.mia ? "mia" : undefined}>
              <span className="lnd-t-pos">{i + 1}</span>
              <Escudo valor={f.escudo} etiqueta={`Escudo de ${f.nombre}`} tamano={24} />
              <span className="lnd-t-n">{f.nombre} <em>{f.sub}</em></span>
              <b className="lnd-t-pts">{f.puntos}</b>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
