"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { InfoTip } from "@/components/InfoTip";
import { BarraPestanas, Boton, Cargando, Escudo, ErrorLiga, Segmentado } from "../../_ui";
import { expulsarDeLiga, rotarCodigoLiga, salirLiga, verLiga, type LigaDetalle } from "@/lib/liga/api";
import { invalidar, useCache } from "@/lib/liga/cache";
import { useSesionRequerida } from "../../_sesion/SesionContext";
import { claseSigno, fecha, porcentaje } from "@/lib/liga/format";
import "../privadas.css";

export default function PrivadaDetalle() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { estado } = useSesionRequerida(`/privadas/${id}`);
  const { datos: liga, cargando, fallo, refrescar: cargar } = useCache<LigaDetalle | string>(
    estado === "dentro" ? `liga:${id}` : null, () => verLiga(id), 120000);
  const [vista, setVista] = useState("mes");
  const [ocupada, setOcupada] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  async function gestionar(accion: () => Promise<unknown>, salir = false) {
    setOcupada(true); setAviso(null);
    try {
      const r = await accion();
      if (typeof r === "string") { setAviso(r); return; }
      invalidar("mis-ligas");
      if (salir) { invalidar(`liga:${id}`); router.push("/privadas"); }
      else { setCopiado(false); cargar(); }
    } finally { setOcupada(false); }
  }

  const lista = typeof liga === "object" && liga ? [...liga.miembros] : [];
  if (vista === "mes") lista.sort((a, b) => (a.rentabilidad_mes == null ? 1 : 0) - (b.rentabilidad_mes == null ? 1 : 0)
    || Number(b.rentabilidad_mes ?? 0) - Number(a.rentabilidad_mes ?? 0) || a.alias.localeCompare(b.alias));
  const activos = lista.filter(m => m.rentabilidad_mes != null).length;

  return <main className="scroll privadas">
    <Link href="/privadas" className="back">← Mis ligas</Link>
    {estado === "cargando" || cargando ? <Cargando filas={4} />
      : fallo || typeof liga === "string" ? <ErrorLiga titulo="No se pudo cargar la liga" mensaje={typeof liga === "string" ? liga : "Reintenta en un momento."} accion={{ texto: "Reintentar", onClick: cargar }} />
      : liga && <>
        <header className="priv-cabecera">
          <p className="priv-eyebrow">Liga privada · {liga.es_dueno ? "La organizas tú" : "Tu grupo"}</p>
          <h1 className="h1">{liga.nombre}</h1>
          <p className="meta">Las mismas jornadas y el mismo índice. La comparación, entre vosotros.</p>
          <dl className="priv-resumen">
            <div><dt>Participantes</dt><dd>{liga.n_miembros}<small> / {liga.cupo}</small></dd></div>
            <div><dt>Con resultado este mes</dt><dd>{activos}</dd></div>
            <div><dt>S&amp;P este mes</dt><dd className={liga.sp500_mes == null ? "" : claseSigno(liga.sp500_mes)}>{liga.sp500_mes == null ? "—" : porcentaje(liga.sp500_mes)}</dd></div>
          </dl>
        </header>
        <div className="priv-contenido">
          <section className="priv-clasificacion" aria-label="Equipos y resultados">
            <Segmentado etiquetaGrupo="Resultados del grupo" valor={vista} onChange={setVista}
              opciones={[{ valor: "mes", etiqueta: "Este mes" }, { valor: "oficial", etiqueta: "Clasificación" }]} />
            <p className="fine priv-contexto">{vista === "mes"
              ? liga.jornada_numero ? `Jornada ${liga.jornada_numero} · ${liga.en_vivo ? "Cotizaciones provisionales" : "Últimos cierres disponibles"}${liga.datos_hasta ? ` · ${fecha(liga.datos_hasta)}` : " · esperando precios"}. Se actualiza cada dos minutos.`
                : "Todavía no hay una jornada formada. Aquí aparecerá la evolución del grupo."
              : "Orden por puntos oficiales de la temporada; en empate, por diferencia acumulada frente al S&P."}</p>
            <details className="priv-metodo"><summary>¿Qué estrategia representa a cada persona?</summary>
              <p>La mejor clasificada de la temporada. Si aún no tiene puntos, se usa la más antigua de sus estrategias con cartera formada en la temporada. No hace falta inscribirla otra vez en esta liga.</p>
              <p>El acumulado muestra el periodo de cada estrategia, que puede ser distinto. Compartir liga no da acceso a metodologías privadas.</p>
            </details>
            {vista === "mes" && liga.consultado && <p className="fine">Mercado consultado a las {new Date(liga.consultado).toLocaleTimeString("es-ES", {hour:"2-digit",minute:"2-digit"})}. Las cotizaciones de Yahoo pueden tener retraso.</p>}
            <div className="priv-equipos">
              {lista.map((m, i) => {
                const e = m.estrategia;
                const conResultado = vista === "mes" ? m.rentabilidad_mes != null : m.puntos != null;
                return <article className={`priv-equipo${m.es_yo ? " propia" : ""}`} key={m.alias}>
                  <button type="button" className="priv-equipo-cab priv-equipo-abrir" disabled={!e}
                    onClick={() => e && router.push(`/ficha/${e.id}`)}>
                    <span className="priv-puesto" aria-label={conResultado ? `Posición ${i + 1}` : "Sin clasificar"}>{conResultado ? String(i + 1).padStart(2, "0") : "—"}</span>
                    {e && <Escudo valor={e.escudo} etiqueta={`Escudo de ${e.nombre}`} tamano={38} />}
                    <span className="priv-identidad"><b>{e?.nombre ?? m.alias}</b><small>{e ? m.alias : "Sin estrategia formada"}{m.es_yo ? " · tú" : ""}</small></span>
                    <span className="priv-resultado">{vista === "mes" ? <b className={m.rentabilidad_mes == null ? "" : claseSigno(m.rentabilidad_mes)}>{m.rentabilidad_mes == null ? "—" : porcentaje(m.rentabilidad_mes)}</b> : <b>{m.puntos ?? "—"}</b>}<small>{vista === "mes" ? "Este mes" : "Puntos"}</small></span>
                    {e && <span aria-hidden="true">→</span>}
                  </button>
                  {!e && <p className="fine">{m.es_yo ? "Crea una estrategia y apúntala a la próxima jornada para empezar a comparar." : "Cuando se forme su primera cartera, aparecerán aquí sus resultados."}{m.es_yo && <Link className="link" href="/crear"> Crear estrategia →</Link>}</p>}
                </article>;
              })}
            </div>
          </section>
          <aside className="priv-gestion">
            {liga.es_dueno && liga.codigo && <section className="priv-panel">
              <h2>Invita a tu grupo</h2><p>Comparte este código. Podrán usarlo en Ligas privadas con una cuenta Pro.</p>
              <code className="priv-codigo">{liga.codigo}</code>
              <Boton ancho="completo" onClick={async () => { try { await navigator.clipboard.writeText(liga.codigo!); setCopiado(true); } catch { setAviso("Selecciona el código y cópialo a mano."); } }}>{copiado ? "Código copiado" : "Copiar código"}</Boton>
              <details className="priv-metodo"><summary>Cambiar código de invitación</summary><p>El anterior dejará de funcionar. Quienes ya estén dentro seguirán en la liga.</p>
                <Boton disabled={ocupada} onClick={() => { if (window.confirm("¿Cambiar el código de invitación?")) void gestionar(() => rotarCodigoLiga(id)); }}>Generar otro código</Boton>
              </details>
            </section>}
            <section className="priv-panel"><h2>Cómo se compara <InfoTip text="Los puntos se fijan al cerrar cada jornada. El retorno mensual es provisional y no altera la clasificación oficial hasta el cierre." /></h2>
              <p>Este mes ordena por rentabilidad. Clasificación conserva los puntos oficiales. Las métricas de riesgo necesitan historial suficiente.</p>
              <Link className="link" href="/como-funciona">Ver las reglas de la Liga →</Link>
            </section>
            <details className="priv-panel"><summary>Gestionar participantes</summary>
              {liga.miembros.map(m => <div className="priv-miembro" key={m.alias}><span>{m.alias}{m.es_yo ? " · tú" : ""}<small>Desde {fecha(m.unido.slice(0, 10))}</small></span>
                {liga.es_dueno && !m.es_yo && <Boton variante="discreto" disabled={ocupada} onClick={() => { if (window.confirm(`¿Expulsar a ${m.alias}?`)) void gestionar(() => expulsarDeLiga(id, m.alias)); }}>Expulsar</Boton>}</div>)}
              {!liga.es_dueno && <Boton disabled={ocupada} onClick={() => { if (window.confirm("¿Salir de esta liga?")) void gestionar(() => salirLiga(id), true); }}>Salir de esta liga</Boton>}
            </details>
          </aside>
        </div>
      </>}
    {aviso && <p className="aviso" role="alert">{aviso}</p>}
    <BarraPestanas />
  </main>;
}
