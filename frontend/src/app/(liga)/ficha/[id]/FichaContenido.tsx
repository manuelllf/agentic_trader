"use client";

// La API proyecta la ficha según permisos; la interfaz nunca reconstruye una receta privada.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BarraPestanas, Boton, Cargando, CASA, Cifra, Escudo, escudoCasa, ErrorLiga, Segmentado,
} from "../../_ui";
import { copiarEstrategia, getCatalogo, getFicha, reportar, type Catalogo, type Ficha, type MercadoFicha } from "@/lib/liga/api";
import { invalidar, useCache } from "@/lib/liga/cache";
import { useSesionRequerida } from "../../_sesion/SesionContext";
import { RendimientoFicha } from "./RendimientoFicha";
import { EvidenciaCartera } from "./EvidenciaCartera";
import { CambiosEstrategia } from "../../_ui/CambiosEstrategia";
import { getSeguimiento, marcarSeguimientos, type SeguimientoEstrategia } from "@/lib/liga/seguimiento";
import { claseSigno, fecha, porcentaje } from "@/lib/liga/format";

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

function CarteraSinEvidencia({ posiciones, mercado }: { posiciones: Ficha["posiciones"]; mercado?: MercadoFicha | null }) {
  const [ticker, setTicker] = useState<string | null>(null);
  const dialogo = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dialogo.current;
    if (!ticker || !d) return;
    d.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { d.close(); document.body.style.overflow = overflow; };
  }, [ticker]);
  const cotizacion = ticker ? mercado?.empresas[ticker] : null;
  return <section className="sec"><h3 className="sec-t">Cartera · {posiciones.length} empresas</h3>
    <div className="cartera-plantilla">{posiciones.map(p => <button type="button" className="cartera-empresa con-precio" key={p.ticker} onClick={() => setTicker(p.ticker)}>
      <b>{p.ticker}</b><span>{Number(p.peso).toFixed(1).replace(".", ",")} %<small>Peso</small></span>
      <span>{mercado?.empresas[p.ticker]?.precio == null ? "—" : Number(mercado.empresas[p.ticker]!.precio).toLocaleString("es-ES")}<small>Precio</small></span>
      <span><b className={`cartera-retorno ${mercado?.empresas[p.ticker]?.rentabilidad == null ? "fl" : claseSigno(mercado.empresas[p.ticker]!.rentabilidad!)}`}>{mercado?.empresas[p.ticker]?.rentabilidad == null ? "—" : porcentaje(mercado.empresas[p.ticker]!.rentabilidad!)}</b><small>Este mes · provisional</small></span><span aria-hidden="true">→</span>
    </button>)}</div>
    <dialog ref={dialogo} className="lecturas-modal empresa-modal" aria-label={`Empresa ${ticker ?? ""}`} onCancel={() => setTicker(null)}>
      <header className="lecturas-cab"><h2>{ticker}</h2><button type="button" className="lecturas-cerrar" autoFocus aria-label="Cerrar empresa" onClick={() => setTicker(null)}>×</button></header>
      <div className="lecturas-cuerpo"><p>Precio: {cotizacion?.precio == null ? "—" : Number(cotizacion.precio).toLocaleString("es-ES")}</p>
        <p>Retorno del mes: {cotizacion?.rentabilidad == null ? "—" : porcentaje(cotizacion.rentabilidad)}</p>
        <p className="fine">{cotizacion?.dia ? `Datos del ${fecha(cotizacion.dia)}. Provisional.` : "Sin cotización actual disponible."}</p>
        <p className="fine">No hay evidencia histórica disponible para verificar las reglas de esta empresa.</p></div>
    </dialog>
  </section>;
}

export function FichaContenido({ id, incrustada = false }: { id: string; incrustada?: boolean }) {
  const router = useRouter();
  const { estado, yo } = useSesionRequerida(`/ficha/${id}`);
  const sesionLista = estado !== "cargando";
  const { datos: catalogo } = useCache<Catalogo | string>("catalogo", getCatalogo);

  // Clave por `id`: al navegar entre fichas (back/forward, o de una a otra) cada una tiene su
  // propia entrada en la caché, así que una respuesta lenta de la ficha anterior nunca puede
  // pisar la de la que se está mirando ahora (M5 del informe de fluidez).
  const { datos: ficha, cargando: cargandoFicha, refrescar: refrescarFicha } = useCache<Ficha | string>(
    sesionLista && estado === "dentro" ? `ficha:${id}` : null, () => getFicha(id), 120000,
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
  const [vista, setVista] = useState("cartera");
  const [metodo, setMetodo] = useState("idea");

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

  const Contenedor = incrustada ? "div" : "main";
  return (
    <Contenedor className={incrustada ? "ficha-incrustada" : "scroll"}>
      {!incrustada && <Link href="/liga" className="back" style={{ marginTop: 4 }} onClick={(evento) => {
        if (evento.ctrlKey || evento.metaKey || evento.shiftKey || evento.altKey) return;
        if (window.history.length > 1) { evento.preventDefault(); router.back(); }
      }}>
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 6l-6 6 6 6" />
        </svg>
        Volver
      </Link>}

      {cargandoFicha ? (
        <div style={{ marginTop: 20 }}><Cargando filas={4} /></div>
      ) : typeof ficha === "string" ? (
        <ErrorLiga titulo="No se pudo cargar la ficha" mensaje={ficha}
                   accion={{ texto: "Reintentar", onClick: refrescarFicha }} />
      ) : !ficha ? null : (
        <>
          {!incrustada && <div className="fh" style={{ marginTop: 16 }}>
            <Escudo valor={ficha.casa ? escudoCasa(ficha.casa) : ficha.escudo}
              casa={ficha.casa} etiqueta={`Escudo de ${ficha.nombre}`} tamano={52} />
            <div>
              <h2>{ficha.nombre}</h2>
              <p>{subtitulo(ficha, ficha.es_dueno)}</p>
            </div>
          </div>}

          {ficha.mercado && <section className="ficha-marcador" aria-label="Resultado provisional de la cartera">
            <div><small>Cartera · este mes</small><b className={ficha.mercado.rentabilidad == null ? "" : claseSigno(ficha.mercado.rentabilidad)}>{ficha.mercado.rentabilidad == null ? "—" : porcentaje(ficha.mercado.rentabilidad)}</b></div>
            <div><small>S&amp;P 500 · mismo periodo</small><b>{ficha.mercado.sp500 == null ? "—" : porcentaje(ficha.mercado.sp500)}</b></div>
            <p className="fine">Provisional desde {fecha(ficha.mercado.desde)} · {ficha.mercado.consultado ? `consultado a las ${new Date(ficha.mercado.consultado).toLocaleTimeString("es-ES", {hour:"2-digit",minute:"2-digit"})}` : "esperando actualización de mercado"} · datos del {fecha(ficha.mercado.dia)}. Refresco cada 2 min. Yahoo puede entregar cotizaciones con retraso.</p>
          </section>}
          <Segmentado className="ficha-nav" etiquetaGrupo="Ficha de la estrategia" valor={vista} onChange={setVista}
            opciones={[{ valor: "cartera", etiqueta: "Cartera" }, { valor: "metodo", etiqueta: "Metodología" }, { valor: "resultados", etiqueta: "Resultados" }]} />
          {vista === "resultados" && <div className={ficha.es_dueno && seguimiento ? "ficha-distribucion" : undefined}>
            <RendimientoFicha datos={ficha.rendimiento} posiciones={ficha.posiciones} />
            {ficha.es_dueno && seguimiento && (
              <aside><CambiosEstrategia key={`${id}:${seguimiento.ultima_inscripcion_id}:${seguimiento.ultimo_resultado_inscripcion_id}`} resumen={seguimiento} alMostrar={alMostrarSeguimiento} /></aside>
            )}
          </div>}

          {vista === "metodo" && !ficha.receta && <p className="meta">Esta metodología no está disponible para tu cuenta.</p>}
          {vista === "metodo" && ficha.receta && (
            <section className="ficha-metodologia">
              <Segmentado etiquetaGrupo="Pasos de la metodología" valor={metodo} onChange={setMetodo}
                opciones={[{ valor: "idea", etiqueta: "Idea" }, { valor: "reglas", etiqueta: "Reglas" }, { valor: "jev", etiqueta: "Jev" }, { valor: "reparto", etiqueta: "Reparto" }]} />
              {metodo === "idea" && <div className="sec"><h3 className="sec-t">La idea</h3><p className="meta">{ficha.receta.idea || "No hay una idea escrita para esta estrategia."}</p></div>}
              {metodo === "reglas" && <div className="sec">
                <div className="sec-t">Sus reglas</div>
                <p className="fine">Método guardado. La cartera en juego mantiene sus posiciones hasta la próxima revisión.</p>
                <div className="rules">
                  {ficha.receta.reglas.length === 0 && <p className="meta">Sin filtros adicionales.</p>}
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
              </div>}
              {metodo === "reparto" && <div className="sec">
                <div className="sec-t">Construcción y revisión</div>
                <p className="fine">Hasta {ficha.receta.n_empresas} empresas · {ficha.receta.reparto === "igual" ? "Pesos iguales" : "Pesos según puntuación"} · {Number(ficha.receta.max_por_sector) === 0 ? "sin límite por sector" : `máximo ${ficha.receta.max_por_sector} por sector`}.</p>
                <p className="fine">Revisión mensual, el primer día de mercado de cada mes.</p>
                {ficha.receta.excluidas.length > 0 && <p className="fine">Excluidas: {ficha.receta.excluidas.join(", ")}.</p>}
              </div>}
              {metodo === "jev" && <div className="sec">
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
              </div>}
              {metodo === "jev" && ficha.receta.pregunta && (
                <div className="sec">
                  <div className="sec-t">Su pregunta a la IA</div>
                  <p className="q">«{ficha.receta.pregunta}»</p>
                </div>
              )}
            </section>
          )}

          {vista === "cartera" && ficha.rendimiento?.evidencia && <EvidenciaCartera datos={ficha.rendimiento.evidencia} mercado={ficha.mercado} />}
          {vista === "cartera" && !ficha.rendimiento?.evidencia && ficha.posiciones.length > 0 && (
            <CarteraSinEvidencia posiciones={ficha.posiciones} mercado={ficha.mercado} />
          )}
          {vista === "cartera" && !ficha.rendimiento?.evidencia && ficha.posiciones.length === 0 && <p className="meta">{ficha.rendimiento?.estado === "privado" ? "Esta cartera es privada. Sus resultados oficiales siguen disponibles en Resultados." : "Todavía no hay una cartera visible para esta estrategia."}</p>}

          {vista === "cartera" && ficha.casa === "omega" && (
            <div className="sec">
              <div className="sec-t">Su cartera</div>
              <p className="fine">Cambia durante el mes.</p>
            </div>
          )}

          {vista === "resultados" && <section className="sec">
            <h3 className="sec-t">Historial · {ficha.jornadas.length} jornadas</h3>
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
          </section>}

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

      {!incrustada && <BarraPestanas />}
    </Contenedor>
  );
}
