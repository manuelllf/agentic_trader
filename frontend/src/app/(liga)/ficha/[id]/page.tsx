"use client";

// La API proyecta la ficha según permisos; la interfaz nunca reconstruye una receta privada.

import { useCallback, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  BarraPestanas, Boton, Cargando, CASA, Cifra, Escudo, escudoCasa, ErrorLiga,
} from "../../_ui";
import { copiarEstrategia, getCatalogo, getFicha, reportar, type Catalogo, type Ficha } from "@/lib/liga/api";
import { invalidar, useCache } from "@/lib/liga/cache";
import { useSesionRequerida } from "../../_sesion/SesionContext";
import { RendimientoFicha } from "./RendimientoFicha";
import { EvidenciaCartera } from "./EvidenciaCartera";
import { CambiosEstrategia } from "../../_ui/CambiosEstrategia";
import { getSeguimiento, marcarSeguimientos, type SeguimientoEstrategia } from "@/lib/liga/seguimiento";

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
  const { datos: catalogo } = useCache<Catalogo | string>("catalogo", getCatalogo);

  // Clave por `id`: al navegar entre fichas (back/forward, o de una a otra) cada una tiene su
  // propia entrada en la caché, así que una respuesta lenta de la ficha anterior nunca puede
  // pisar la de la que se está mirando ahora (M5 del informe de fluidez).
  const { datos: ficha, cargando: cargandoFicha, refrescar: refrescarFicha } = useCache<Ficha | string>(
    sesionLista && estado === "dentro" ? `ficha:${id}` : null, () => getFicha(id),
  );
  const { datos: seguimientos } = useCache<SeguimientoEstrategia[] | string>(
    typeof ficha !== "string" && ficha?.es_dueno ? `seguimiento:${id}` : null, getSeguimiento,
  );
  const seguimiento = Array.isArray(seguimientos)
    ? seguimientos.find((s) => s.estrategia_id === id) : undefined;

  const alMostrarSeguimiento = useCallback(() => {
    if (!seguimiento) return;
    void marcarSeguimientos([{
      estrategia_id: seguimiento.estrategia_id,
      inscripcion_id: seguimiento.ultima_inscripcion_id,
      resultado_inscripcion_id: seguimiento.ultimo_resultado_inscripcion_id,
    }]).then((r) => {
      // Conserva el resumen que se está leyendo; Mías recoge la revisión al volver.
      if (typeof r !== "string") invalidar("seguimiento");
    });
  }, [seguimiento]);
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
            <Escudo valor={ficha.casa ? escudoCasa(ficha.casa) : ficha.escudo}
              casa={ficha.casa} etiqueta={`Escudo de ${ficha.nombre}`} tamano={52} />
            <div>
              <h2>{ficha.nombre}</h2>
              <p>{subtitulo(ficha, ficha.es_dueno)}</p>
              {ficha.receta?.idea && <p>{ficha.receta.idea}</p>}
            </div>
          </div>

          <div className={ficha.es_dueno && seguimiento ? "ficha-distribucion" : undefined}>
            <RendimientoFicha datos={ficha.rendimiento} posiciones={ficha.posiciones} />
            {ficha.es_dueno && seguimiento && (
              <aside><CambiosEstrategia key={`${id}:${seguimiento.ultima_inscripcion_id}:${seguimiento.ultimo_resultado_inscripcion_id}`} resumen={seguimiento} alMostrar={alMostrarSeguimiento} /></aside>
            )}
          </div>

          {ficha.receta && (
            <div className="ficha-metodo">
              <div className="sec">
                <div className="sec-t">Sus reglas</div>
                <p className="fine">Método guardado. La cartera en juego mantiene sus posiciones hasta la próxima revisión.</p>
                <div className="rules">
                  {ficha.receta.reglas.map((r, i) => (
                    <div className="rulec" key={i}>
                      <div>
                        <b>{typeof catalogo === "object" ? catalogo.reglas.find((d) => d.clave === r.clave)?.titulo ?? r.clave : r.clave}</b>
                        {Object.entries(r.params).map(([clave, valor]) => {
                          const parametro = typeof catalogo === "object"
                            ? catalogo.reglas.find((d) => d.clave === r.clave)?.parametros.find((p) => p.nombre === clave) : undefined;
                          const texto = Array.isArray(valor) ? valor.map((v) => typeof catalogo === "object"
                            ? catalogo.sectores[String(v)] ?? String(v) : String(v)).join(", ") : String(valor);
                          return <p className="fine" key={clave}>{parametro?.etiqueta ?? clave}: {texto}</p>;
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="sec">
                <div className="sec-t">Construcción y revisión</div>
                <p className="fine">Hasta {ficha.receta.n_empresas} empresas · {ficha.receta.reparto === "igual" ? "Pesos iguales" : "Pesos según puntuación"} · {Number(ficha.receta.max_por_sector) === 0 ? "sin límite por sector" : `máximo ${ficha.receta.max_por_sector} por sector`}.</p>
                <p className="fine">Revisión mensual, el primer día de mercado de cada mes.</p>
                {ficha.receta.excluidas.length > 0 && <p className="fine">Excluidas: {ficha.receta.excluidas.join(", ")}.</p>}
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
            </div>
          )}

          {ficha.rendimiento?.evidencia && <EvidenciaCartera datos={ficha.rendimiento.evidencia} />}
          {!ficha.rendimiento?.evidencia && ficha.posiciones.length > 0 && (
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

          <div className="sec">
            <div className="sec-t">En la Liga · mes a mes</div>
            <p className="fine">Resultados oficiales de cada jornada. Los puntos resumen la comparación con el S&amp;P 500 al cierre.</p>
            {ficha.jornadas.length === 0 ? (
              <p className="meta">Todavía no tiene resultados de jornadas.</p>
            ) : ficha.jornadas.map((j) => (
              <div className="month" key={j.numero}>
                <span>Jornada {j.numero}</span>
                {j.rentabilidad !== null ? <Cifra valor={j.rentabilidad} /> : <span className="fl">—</span>}
                <span className="num">{j.puntos !== null ? `${j.puntos} pts` : "—"}</span>
              </div>
            ))}
            <p className="fine"><Link href="/liga">Comparar con las demás estrategias →</Link></p>
          </div>

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
                {!ficha.casa && ficha.receta && (
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
                {!ficha.casa && !ficha.receta && <p className="fine">La metodología solo puede copiarse con Pro cuando su autor la publica.</p>}
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
