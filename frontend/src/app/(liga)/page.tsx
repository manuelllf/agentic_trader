"use client";

// Pantalla «Liga» (DESIGN.md §7 «Liga»/«Clasificación»/«Este mes»): el marcador, la clasificación
// de la temporada y «Este mes», con datos reales y públicos (`/liga/publico/*`, D3: se ve sin
// cuenta). Sin temporada todavía (hoy: todos los campos de `/liga/publico/portada` son `null`) se
// enseña un estado vacío honesto en vez de inventar filas.
//
// Gap de backend (ver el informe de F7): `EquipoOut` no manda `visibilidad`, así que no se puede
// distinguir aquí «publicada» de «privada» como pide la leyenda de la maqueta; se usa una
// etiqueta neutra («de la comunidad») para las que no son de la casa ni la propia.

import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BarraPestanas, CabeceraApp, Cargando, Clasificacion as TablaClasificacion, Escudo, ErrorLiga,
  FilaEquipo, HuecoClasificacion, Segmentado, Vacio,
} from "./_ui";
import {
  getClasificacion, getJornadaPublica, getPortada, getYo,
  type Clasificacion, type EquipoPublico, type JornadaDetalle, type Portada, type Yo,
} from "@/lib/liga/api";
import { claseSigno, fecha, porcentaje } from "@/lib/liga/format";
import { useSupabase } from "@/lib/liga/supabase";

type Vista = "tabla" | "jornada";

function etiquetaEquipo(e: EquipoPublico, miAlias: string | null): string {
  if (e.casa) return "de la casa";
  if (miAlias && e.autor === miAlias) return "la tuya";
  return "de la comunidad";
}

const Chevron = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 6l6 6-6 6" />
  </svg>
);

export default function Liga() {
  const router = useRouter();
  const sb = useSupabase();
  const [yo, setYo] = useState<Yo | null>(null);
  const [vista, setVista] = useState<Vista>("tabla");
  const [portada, setPortada] = useState<Portada | string | null>(null);
  const [clasificacion, setClasificacion] = useState<Clasificacion | string | null>(null);
  const [jornada, setJornada] = useState<JornadaDetalle | string | null>(null);

  useEffect(() => {
    if (!sb) return;
    (async () => {
      const { data } = await sb.auth.getSession();
      if (data.session) setYo(await getYo());
    })();
  }, [sb]);

  useEffect(() => { (async () => setPortada(await getPortada()))(); }, []);

  useEffect(() => {
    if (vista !== "tabla" || clasificacion !== null) return;
    if (typeof portada !== "object" || !portada || portada.temporada === null) return;
    (async () => setClasificacion(await getClasificacion()))();
  }, [vista, clasificacion, portada]);

  useEffect(() => {
    if (vista !== "jornada" || jornada !== null || typeof portada !== "object" || !portada) return;
    const id = portada.en_juego?.id;
    if (id == null) return;
    (async () => setJornada(await getJornadaPublica(id)))();
  }, [vista, jornada, portada]);

  const abrir = (id: string) => router.push(`/ficha/${id}`);

  if (portada === null) {
    return (
      <main className="scroll">
        <CabeceraApp plan={yo?.plan} />
        <h1 className="h1">Liga</h1>
        <div style={{ marginTop: 20 }}><Cargando filas={4} /></div>
        <BarraPestanas />
      </main>
    );
  }

  if (typeof portada === "string") {
    return (
      <main className="scroll">
        <CabeceraApp plan={yo?.plan} />
        <h1 className="h1">Liga</h1>
        <ErrorLiga titulo="No se pudo cargar la liga" mensaje={portada}
                   accion={{ texto: "Reintentar", onClick: () => window.location.reload() }} />
        <BarraPestanas />
      </main>
    );
  }

  const { temporada } = portada;

  return (
    <main className="scroll">
      <CabeceraApp plan={yo?.plan} />
      <h1 className="h1">Liga</h1>

      {temporada === null ? (
        <Vacio
          titulo={portada.proxima
            ? `La primera jornada empieza el ${fecha(portada.proxima.dia_inicio)}`
            : "La liga todavía no ha empezado"}
          texto="En cuanto arranque la primera jornada verás aquí la clasificación de todas las estrategias contra el S&P 500."
          accion={yo
            ? { texto: "Crear mi estrategia", onClick: () => { window.location.href = "/crear"; } }
            : { texto: "Entrar", onClick: () => { window.location.href = "/entrar?next=/crear"; } }}
        />
      ) : (
        <>
          {portada.en_juego && (
            <div className="board">
              <div>
                <b>Jornada {portada.en_juego.numero} de {temporada.n_jornadas}</b>
                <span>Temporada {temporada.nombre}</span>
              </div>
              {portada.en_juego.sp_rentabilidad != null && (
                <div className="r">
                  <span>S&amp;P este mes</span>
                  <b className={`num ${claseSigno(portada.en_juego.sp_rentabilidad)}`}>
                    {porcentaje(portada.en_juego.sp_rentabilidad)}
                  </b>
                </div>
              )}
            </div>
          )}
          <p className="meta" style={{ marginTop: 10 }}>
            Temporada {temporada.nombre}.{" "}
            {typeof clasificacion === "object" && clasificacion
              ? `Juegan ${clasificacion.total} estrategias.`
              : ""}
          </p>

          <div style={{ marginTop: 16 }}>
            <Segmentado etiquetaGrupo="Vista de la liga" valor={vista} onChange={setVista}
                        opciones={[{ valor: "tabla", etiqueta: "Clasificación" },
                                   { valor: "jornada", etiqueta: "Este mes" }]} />
          </div>

          {vista === "tabla" ? (
            clasificacion === null ? (
              <div style={{ marginTop: 20 }}><Cargando filas={5} /></div>
            ) : typeof clasificacion === "string" ? (
              <ErrorLiga titulo="No se pudo cargar la clasificación" mensaje={clasificacion}
                         accion={{ texto: "Reintentar",
                                   onClick: () => { setClasificacion(null); } }} />
            ) : clasificacion.filas.length === 0 ? (
              <Vacio titulo="Aún no juegas nadie"
                     texto="Nadie se ha apuntado todavía a esta temporada."
                     accion={yo
                       ? { texto: "Crear la mía", onClick: () => { window.location.href = "/crear"; } }
                       : { texto: "Entrar", onClick: () => { window.location.href = "/entrar"; } }} />
            ) : (
              <div className="sec" style={{ marginTop: 20 }}>
                <TablaClasificacion>
                  {clasificacion.filas.map((f) => (
                    <FilaEquipo
                      key={f.equipo.id}
                      puesto={f.posicion}
                      nombre={f.equipo.nombre}
                      escudo={f.equipo.escudo}
                      etiqueta={etiquetaEquipo(f.equipo, yo?.alias ?? null)}
                      vsIndice={f.dif_sp}
                      puntos={f.puntos}
                      tipo={f.equipo.casa ? "casa" : (yo && f.equipo.autor === yo.alias) ? "mia" : "normal"}
                      colorCasa={f.equipo.casa ? { alpha: "#1DE27A", omega: "#FF6B1A", lambda: "#8F8A80" }[f.equipo.casa] : undefined}
                      onClick={() => abrir(f.equipo.id)}
                    />
                  ))}
                  {clasificacion.total > clasificacion.filas.length && (
                    <HuecoClasificacion>y {clasificacion.total - clasificacion.filas.length} más</HuecoClasificacion>
                  )}
                </TablaClasificacion>
                <div className="legend">
                  <p>α Alpha, Ω Omega y λ Lambda son de la casa y juegan con las mismas reglas.</p>
                  <p>«vs S&amp;P» es lo que cada una lleva de más o de menos que el índice en la temporada.</p>
                </div>
              </div>
            )
          ) : jornada === null ? (
            portada.en_juego ? <div style={{ marginTop: 20 }}><Cargando filas={4} /></div>
              : (
                <Vacio titulo="Todavía no hay jornada en juego"
                       texto="Cuando empiece la jornada de este mes verás aquí cómo va cada estrategia." />
              )
          ) : typeof jornada === "string" ? (
            <ErrorLiga titulo="No se pudo cargar este mes" mensaje={jornada}
                       accion={{ texto: "Reintentar", onClick: () => { setJornada(null); } }} />
          ) : (
            <VistaJornada detalle={jornada} miAlias={yo?.alias ?? null} onAbrir={abrir} />
          )}
        </>
      )}

      <BarraPestanas />
    </main>
  );
}

function VistaJornada({
  detalle, miAlias, onAbrir,
}: { detalle: JornadaDetalle; miAlias: string | null; onAbrir: (id: string) => void }) {
  const conDatos = detalle.filas.filter((f) => f.rentabilidad !== null);
  if (conDatos.length === 0) {
    return (
      <p className="callout" style={{ marginTop: 20 }}>
        Esta jornada todavía no tiene resultados: se calculan al cerrar el día 1 del mes que viene.
      </p>
    );
  }
  const grupos: Record<"G" | "E" | "P", typeof conDatos> = { G: [], E: [], P: [] };
  for (const f of conDatos) {
    const dif = f.dif_sp ?? 0;
    grupos[dif > 0.5 ? "G" : dif >= -0.5 ? "E" : "P"].push(f);
  }
  const sp = detalle.jornada.sp_rentabilidad;
  const fila = (f: (typeof conDatos)[number]) => (
    <button type="button" key={f.equipo.id}
            className={`jr${f.equipo.casa ? " casa" : ""}`}
            style={f.equipo.casa ? ({ "--hc": { alpha: "#1DE27A", omega: "#FF6B1A", lambda: "#8F8A80" }[f.equipo.casa] } as CSSProperties) : undefined}
            onClick={() => onAbrir(f.equipo.id)}>
      <span className="name">
        <Escudo valor={f.equipo.escudo} etiqueta={`Escudo de ${f.equipo.nombre}`} />
        <span className="nm">
          <b>{f.equipo.nombre}</b>
          <span className="sub">{etiquetaEquipo(f.equipo, miAlias)}</span>
        </span>
      </span>
      <span className={`ret num ${claseSigno(f.rentabilidad ?? 0)}`}>{porcentaje(f.rentabilidad ?? 0)}</span>
      <Chevron />
    </button>
  );
  return (
    <div className="sec" style={{ marginTop: 20 }}>
      {sp != null && (
        <div className="jr spx">
          <span className="nm"><b>S&amp;P 500</b></span>
          <span className={`ret num ${claseSigno(sp)}`}>{porcentaje(sp)}</span>
          <span />
        </div>
      )}
      <p className="grp">Ganando el mes <small>{grupos.G.length}</small></p>
      {grupos.G.map(fila)}
      <p className="grp">Empatando <small>a medio punto o menos del S&amp;P</small></p>
      {grupos.E.map(fila)}
      <p className="grp">Perdiendo <small>{grupos.P.length}</small></p>
      {grupos.P.map(fila)}
    </div>
  );
}
