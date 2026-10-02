"use client";

// Ficha de una estrategia (DESIGN.md §7 «Ficha»), pantalla propia con URL en vez de hoja: misma
// simplificación de F7 que EditorEstrategia (nada de sistema de hojas todavía). Solo pinta lo que
// `GET /liga/fichas/{id}` manda (ya proyectado según quién mira, D4): sin cartera ni receta cuando
// la API no las da.
//
// Gaps de backend (ver el informe de F7): la ficha no manda ni el puesto en la clasificación ni
// la diferencia contra el S&P por jornada, así que no se pinta la cabecera «12.º de 142, N
// puntos» ni el gráfico de temporada de la maqueta — solo la tabla mes a mes con lo que sí hay
// (rentabilidad y puntos).

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  BarraPestanas, Boton, CabeceraApp, Cargando, CASA, Cifra, Escudo, ErrorLiga,
} from "../../_ui";
import { copiarEstrategia, getFicha, reportar, type Ficha } from "@/lib/liga/api";
import { useCache } from "@/lib/liga/cache";
import { useSesionRequerida } from "../../_sesion/SesionContext";

const ETIQUETA_PESO: Record<string, string> = {
  negocio: "El negocio", precio: "El precio", deuda: "La deuda", pronto: "Algo a favor pronto",
  pregunta: "Tu pregunta",
};

function subtitulo(f: Ficha, esMia: boolean): string {
  if (f.casa) return `De la casa: ${CASA[f.casa].nombre}`;
  if (esMia) return "La tuya";
  if (f.autor) return `De ${f.autor}`;
  return "Estrategia retirada";
}

export default function FichaPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { estado, yo } = useSesionRequerida(`/ficha/${id}`);
  const sesionLista = estado !== "cargando";

  // Clave por `id`: al navegar entre fichas (back/forward, o de una a otra) cada una tiene su
  // propia entrada en la caché, así que una respuesta lenta de la ficha anterior nunca puede
  // pisar la de la que se está mirando ahora (M5 del informe de fluidez).
  const { datos: ficha, cargando: cargandoFicha, refrescar: refrescarFicha } = useCache<Ficha | string>(
    sesionLista && estado === "dentro" ? `ficha:${id}` : null, () => getFicha(id),
  );
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  async function alCopiar() {
    setOcupado(true);
    setAviso(null);
    const r = await copiarEstrategia(id);
    setOcupado(false);
    if (typeof r === "string") { setAviso(r); return; }
    router.push(`/crear/${r.id}`);
  }

  async function alReportar() {
    const motivo = window.prompt("¿Por qué reportas esta estrategia? Cuéntanos qué pasa.");
    if (!motivo || !motivo.trim()) return;
    setOcupado(true);
    const r = await reportar("estrategia", id, motivo.trim());
    setOcupado(false);
    setAviso(typeof r === "string" ? r : "Gracias, lo revisamos.");
  }

  return (
    <main className="scroll">
      <CabeceraApp />
      <Link href="/liga" className="back" style={{ marginTop: 4 }} onClick={(evento) => {
        if (evento.ctrlKey || evento.metaKey || evento.shiftKey || evento.altKey) return;
        if (window.history.length > 1) { evento.preventDefault(); router.back(); }
      }}>
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 6l-6 6 6 6" />
        </svg>
        Volver
      </Link>

      {cargandoFicha ? (
        <div style={{ marginTop: 20 }}><Cargando filas={4} /></div>
      ) : typeof ficha === "string" ? (
        <ErrorLiga titulo="No se pudo cargar la ficha" mensaje={ficha}
                   accion={{ texto: "Reintentar", onClick: refrescarFicha }} />
      ) : !ficha ? null : (
        <>
          <div className="fh" style={{ marginTop: 16 }}>
            <Escudo valor={ficha.escudo} etiqueta={`Escudo de ${ficha.nombre}`} tamano={52} />
            <div>
              <h2>{ficha.nombre}</h2>
              <p>{subtitulo(ficha, ficha.es_dueno)}</p>
            </div>
          </div>

          <div className="sec">
            <div className="sec-t">Mes a mes</div>
            {ficha.jornadas.length === 0 ? (
              <p className="meta">Todavía no ha jugado ninguna jornada.</p>
            ) : (
              ficha.jornadas.map((j) => (
                <div className="month" key={j.numero}>
                  <span>Jornada {j.numero}</span>
                  {j.rentabilidad !== null ? <Cifra valor={j.rentabilidad} /> : <span className="fl">—</span>}
                  <span className="num">{j.puntos !== null ? `+${j.puntos}` : "—"}</span>
                </div>
              ))
            )}
          </div>

          {ficha.receta && (
            <>
              <div className="sec">
                <div className="sec-t">Sus reglas</div>
                <div className="rules">
                  {ficha.receta.reglas.map((r, i) => (
                    <div className="rulec" key={i}>
                      <div><b>{r.clave}</b></div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="sec">
                <div className="sec-t">Qué pesa más</div>
                {Object.entries(ficha.receta.pesos).filter(([, v]) => v > 0).map(([k, v]) => {
                  const total = Object.values(ficha.receta!.pesos).reduce((a, b) => a + b, 0) || 1;
                  const pct = Math.round((v * 100) / total);
                  return (
                    <div className={`wrow${k === "pregunta" ? " own" : ""}`} key={k}>
                      <span>{ETIQUETA_PESO[k] ?? k}</span>
                      <span className="num">{pct}&nbsp;%</span>
                      <div className="wbar"><i style={{ width: `${pct}%` }} /></div>
                    </div>
                  );
                })}
              </div>
              {ficha.receta.pregunta && (
                <div className="sec">
                  <div className="sec-t">Su pregunta a la IA</div>
                  <p className="q">«{ficha.receta.pregunta}»</p>
                </div>
              )}
            </>
          )}

          {ficha.posiciones.length > 0 && (
            <div className="sec">
              <div className="sec-t">Su cartera</div>
              {ficha.posiciones.map((p) => (
                <div className="prow" key={p.ticker}>
                  <div><b>{p.ticker}</b></div>
                  <span className="c num">{Math.round(p.peso)}&nbsp;%</span>
                  <span className="c num fl">—</span>
                </div>
              ))}
              <p className="fine"><Link href="/como-funciona">Cómo se eligen las empresas</Link></p>
            </div>
          )}

          {ficha.casa === "omega" && (
            <div className="sec">
              <div className="sec-t">Su cartera</div>
              <p className="fine">Cambia durante el mes.</p>
            </div>
          )}

          {!ficha.casa && (
            <p className="fine">
              Estrategia de un usuario, no una recomendación de la plataforma. Todo es en papel:
              aquí no se compra ni se vende nada.
            </p>
          )}

          {aviso && <p className="aviso" role="alert" style={{ marginTop: 16 }}>{aviso}</p>}

          <div className="cta">
            {ficha.es_dueno ? (
              <Link href={`/crear/${ficha.id}`} className="btn pri wide">Editar</Link>
            ) : (
              <>
                {!ficha.casa && (
                  yo?.plan === "pro" ? (
                    <Boton variante="principal" ancho="completo" disabled={ocupado} onClick={alCopiar}>
                      Copiar y ajustar
                    </Boton>
                  ) : (
                    <div className="lock">
                      Con Pro puedes copiar esta estrategia y ajustarla a tu gusto.
                    </div>
                  )
                )}
                <Boton variante="discreto" onClick={alReportar} disabled={ocupado}>Reportar</Boton>
              </>
            )}
          </div>
        </>
      )}

      <BarraPestanas />
    </main>
  );
}
