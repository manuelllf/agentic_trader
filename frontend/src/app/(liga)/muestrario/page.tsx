"use client";

import { useState, type ReactNode } from "react";
import { notFound } from "next/navigation";
import { Boton } from "../_ui/Boton";
import { Cargando } from "../_ui/Cargando";
import { Chip } from "../_ui/Chip";
import { Cifra } from "../_ui/Cifra";
import { Clasificacion, HuecoClasificacion } from "../_ui/Clasificacion";
import { ErrorLiga } from "../_ui/ErrorLiga";
import { Escudo, escudoCasa, type EscudoValor } from "../_ui/Escudo";
import { FilaEquipo } from "../_ui/FilaEquipo";
import { Tarjeta } from "../_ui/Tarjeta";
import { Vacio } from "../_ui/Vacio";

const ESCUDO_A: EscudoValor = { forma: "escudo", dibujo: "mitades", color1: "#1D3A6E", color2: "#FFFFFF", iniciales: "" };
const ESCUDO_B: EscudoValor = { forma: "hexagono", dibujo: "diagonal", color1: "#8FBF3F", color2: "#141414", iniciales: "" };
const ESCUDO_C: EscudoValor = { forma: "circulo", dibujo: "franja", color1: "#C0392B", color2: "#F2C94C", iniciales: "TG" };
const ESCUDO_D: EscudoValor = { forma: "escudo", dibujo: "liso", color1: "#5B6470", iniciales: "M" };

function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="sec" aria-labelledby={`s-${titulo}`}>
      <div className="sec-t" id={`s-${titulo}`}>{titulo}</div>
      {children}
    </section>
  );
}

export default function Muestrario() {
  const [cargandoDemo, setCargandoDemo] = useState(false);

  // Solo existe fuera de producción: aquí, y solo aquí, los datos son inventados a propósito
  // (DESIGN.md, cabecera). Sirve para revisar cada pieza del kit sin montar una pantalla real.
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return (
    <main className="scroll" style={{ maxWidth: 480, margin: "0 auto" }}>
      <h1 className="h1">Muestrario</h1>
      <p className="meta">
        Piezas de <code>_ui</code> con valores de ejemplo (inventados, solo para esta pantalla).
        No existe en producción.
      </p>

      <Seccion titulo="Cuenta">
        <p className="fine">Cabecera con sesión y el menú abierto (el de verdad se abre al tocar).</p>
        <div className="sencilla-top" style={{ marginTop: 12, paddingBottom: 150 }}>
          <span className="wordmark">liguilla</span>
          <div className="cuenta">
            <button type="button" className="cuenta-boton" aria-expanded="true">
              <span>admin</span>
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.8"
                      strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <div className="cuenta-menu" role="menu">
              <a className="cuenta-item" role="menuitem" href="#">Tu cuenta</a>
              <a className="cuenta-item" role="menuitem" href="#">Panel de control</a>
              <button type="button" className="cuenta-item salir" role="menuitem">Salir</button>
            </div>
          </div>
        </div>
      </Seccion>

      <Seccion titulo="Escudo">
        <p className="fine">Formas × dibujos, y los tres de la casa con su glifo.</p>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 12, alignItems: "center" }}>
          <Escudo valor={ESCUDO_A} etiqueta="Escudo de Foso ancho" tamano={34} />
          <Escudo valor={ESCUDO_B} etiqueta="Escudo de Solo lo que entiendo" tamano={34} />
          <Escudo valor={ESCUDO_C} etiqueta="Escudo de Tortuga golosa" tamano={34} />
          <Escudo valor={ESCUDO_D} etiqueta="Escudo de Marca que aguanta" tamano={34} />
          <Escudo valor={escudoCasa("alpha")} etiqueta="Escudo de la casa: Alpha" tamano={34} />
          <Escudo valor={escudoCasa("omega")} etiqueta="Escudo de la casa: Omega" tamano={34} />
          <Escudo valor={escudoCasa("lambda")} etiqueta="Escudo de la casa: Lambda" tamano={34} />
        </div>
        <p className="fine">A 52 px (tamaño de ficha):</p>
        <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
          <Escudo valor={ESCUDO_A} etiqueta="Escudo de Foso ancho" tamano={52} />
          <Escudo valor={escudoCasa("omega")} etiqueta="Escudo de la casa: Omega" tamano={52} />
        </div>
      </Seccion>

      <Seccion titulo="Boton">
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
          <Boton variante="principal">Crear la mía</Boton>
          <Boton variante="secundario">Copiar código</Boton>
          <Boton variante="discreto">Deshacer</Boton>
          <div style={{ display: "flex", gap: 10 }}>
            <Boton variante="secundario" ancho="flex">Volver</Boton>
            <Boton variante="principal" ancho="flex">Apuntarla</Boton>
          </div>
          <Boton variante="secundario" tamano="pequeno">Cambiar</Boton>
          <Boton variante="principal" disabled>Sin crédito suficiente</Boton>
        </div>
      </Seccion>

      <Seccion titulo="Chip">
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <Chip>Pro</Chip>
          <Chip onClick={() => setCargandoDemo((v) => !v)}>3,10 €</Chip>
        </div>
      </Seccion>

      <Seccion titulo="Cifra">
        <div style={{ display: "flex", gap: 20, marginTop: 12, fontSize: 19, fontWeight: 800 }}>
          <Cifra valor={2.3} />
          <Cifra valor={-1.6} />
          <Cifra valor={0.02} />
        </div>
      </Seccion>

      <Seccion titulo="Tarjeta">
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
          <Tarjeta>
            <b style={{ display: "block", fontSize: 16, color: "var(--ink)" }}>Poca deuda</b>
            <span style={{ fontSize: 13.5, color: "var(--muted)" }}>
              deuda neta de menos de 2 años de beneficio operativo
            </span>
          </Tarjeta>
          <Tarjeta elevada>
            <b style={{ display: "block", fontSize: 16, color: "var(--ink)" }}>Tarjeta elevada</b>
            <span style={{ fontSize: 13.5, color: "var(--muted)" }}>flota sobre el fondo, con sombra</span>
          </Tarjeta>
        </div>
      </Seccion>

      <Seccion titulo="Clasificacion (con FilaEquipo)">
        <Clasificacion>
          <FilaEquipo
            puesto={1}
            nombre="Foso ancho"
            escudo={ESCUDO_A}
            resultados={["G", "G", "E"]}
            etiqueta="publicada"
            vsIndice={4.8}
            puntos={7}
          />
          <FilaEquipo
            puesto={2}
            nombre="Alpha"
            escudo={escudoCasa("alpha")}
            resultados={["G", "E", "G"]}
            etiqueta="de la casa"
            vsIndice={3.1}
            puntos={7}
            tipo="casa"
            colorCasa={escudoCasa("alpha").color1}
          />
          <FilaEquipo
            puesto={3}
            nombre="Tortuga golosa"
            escudo={ESCUDO_C}
            resultados={["P", "E", "G"]}
            etiqueta="privada"
            vsIndice={-0.6}
            puntos={4}
          />
          <HuecoClasificacion>y 8 más hasta la tuya</HuecoClasificacion>
          <FilaEquipo
            puesto={12}
            nombre="Tu estrategia"
            escudo={ESCUDO_D}
            resultados={["E", "P", "G"]}
            etiqueta="la tuya"
            vsIndice={1.1}
            puntos={5}
            tipo="mia"
            abrible={false}
          />
          <HuecoClasificacion>y 130 más</HuecoClasificacion>
        </Clasificacion>
      </Seccion>

      <Seccion titulo="Vacio">
        <Vacio
          titulo="Aún no juegas"
          texto="Si creas tu estrategia hoy, entra en la próxima jornada y empieza de cero como todas."
          accion={{ texto: "Crear la mía", onClick: () => {} }}
        />
      </Seccion>

      <Seccion titulo="Cargando">
        <Boton variante="secundario" onClick={() => setCargandoDemo((v) => !v)}>
          {cargandoDemo ? "Ver datos" : "Ver esqueleto"}
        </Boton>
        <div style={{ marginTop: 12 }}>
          {cargandoDemo ? (
            <Cargando filas={3} />
          ) : (
            <Clasificacion>
              <FilaEquipo
                puesto={1}
                nombre="Foso ancho"
                escudo={ESCUDO_A}
                resultados={["G", "G", "E"]}
                etiqueta="publicada"
                vsIndice={4.8}
                puntos={7}
              />
            </Clasificacion>
          )}
        </div>
      </Seccion>

      <Seccion titulo="ErrorLiga">
        <ErrorLiga
          titulo="No se pudo cargar la clasificación"
          mensaje="El servidor no ha respondido. Vuelve a intentarlo en un momento."
          accion={{ texto: "Reintentar", onClick: () => {} }}
        />
      </Seccion>
    </main>
  );
}
