"use client";

// Control de la liguilla: temporadas, jornadas y sus procesos. Cada paso se ejecuta tras ver su
// vista previa; el estado sale del dominio (backend/app/liga/procesos/estado.py).

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import AuthGate from "@/components/AuthGate";
import { ApiError, get, post } from "@/lib/api";

type Intento = { cuando: string; ok: boolean; objeto: string | null; detalle: unknown } | null;
type Jornada = {
  id: number; numero: number; dia_inicio: string; dia_fin: string; cierre_inscripcion: string;
  estado: "programada" | "formada" | "cerrada"; foto_id: number | null; scan_run_id: number | null;
  plan_b: boolean | null; inscripciones: number; sp_rentabilidad: string | null;
  siguiente: "foto" | "formar" | "cerrar" | null;
};
type Temporada = { id: number; nombre: string; cuenta: boolean; estado: string; jornadas: Jornada[] };
type Estado = {
  diario_activo: boolean; temporadas: Temporada[]; ultimo_intento: Record<string, Intento>;
};
type Accion = { proceso: string; titulo: string; cuerpo: Record<string, unknown> };

const PASO: Record<string, string> = {
  foto: "Designar la foto", formar: "Formar la jornada", cerrar: "Cerrar la jornada",
};
const MES = new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric", timeZone: "UTC" });
const DIA = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", timeZone: "UTC" });
const CUANDO = new Intl.DateTimeFormat("es-ES", {
  day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid",
});

const error = (e: unknown) => (e instanceof ApiError ? e.message : "Algo falló. Reintenta.");

function Resultado({ datos }: { datos: unknown }) {
  return (
    <pre className="mt-2 max-h-72 overflow-auto rounded-lg p-3 text-[11.5px] leading-relaxed"
         style={{ background: "#141413", color: "#c3c2b7" }}>
      {JSON.stringify(datos, null, 2)}
    </pre>
  );
}

function Liga() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [fallo, setFallo] = useState("");
  const [accion, setAccion] = useState<Accion | null>(null);
  const [previa, setPrevia] = useState<unknown>(null);
  const [hecho, setHecho] = useState<unknown>(null);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(() => {
    get<Estado>("/liga/admin/procesos/estado").then(setEstado).catch((e) => setFallo(error(e)));
  }, []);
  useEffect(cargar, [cargar]);

  const abrir = async (a: Accion) => {
    setAccion(a); setPrevia(null); setHecho(null); setFallo(""); setOcupado(true);
    try {
      setPrevia(await post(`/liga/admin/procesos/${a.proceso}/vista-previa`, a.cuerpo, 90_000));
    } catch (e) { setFallo(error(e)); } finally { setOcupado(false); }
  };

  const ejecutar = async () => {
    if (!accion) return;
    setOcupado(true); setFallo("");
    try {
      setHecho(await post(`/liga/admin/procesos/${accion.proceso}/ejecutar`, accion.cuerpo, 90_000));
      cargar();
    } catch (e) { setFallo(error(e)); } finally { setOcupado(false); }
  };

  const interruptor = async () => {
    if (!estado) return;
    setOcupado(true);
    try {
      await post("/liga/admin/procesos/diario/interruptor", { activo: !estado.diario_activo });
      cargar();
    } catch (e) { setFallo(error(e)); } finally { setOcupado(false); }
  };

  return (
    <main className="mx-auto max-w-md px-4 pb-16 pt-6 text-[13px]" style={{ color: "#c3c2b7" }}>
      <Link href="/admin" className="text-[12.5px]" style={{ color: "#898781" }}>← Salas</Link>
      <h1 className="mt-3 text-[19px] text-white"
          style={{ fontFamily: "var(--font-land-serif)", fontStyle: "italic" }}>Liguilla</h1>

      {fallo && <p className="mt-3 rounded-lg p-3" style={{ background: "#2a1616", color: "#e66767" }}>{fallo}</p>}
      {!estado ? (
        !fallo && <p className="mt-6" style={{ color: "#898781" }}>Cargando…</p>
      ) : (
        <>
          <section className="mt-5 rounded-xl border p-4" style={{ borderColor: "#303030" }}>
            <h2 className="font-bold text-white">Cierres diarios</h2>
            <p className="mt-1" style={{ color: "#898781" }}>
              17:15 de Nueva York en días de bolsa: precios de lo que está en cartera y del SPY.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={interruptor} disabled={ocupado}
                      className="min-h-[44px] rounded-lg px-4 font-bold text-white disabled:opacity-40"
                      style={{ background: estado.diario_activo ? "#1f5f3a" : "#2c2c2a" }}>
                {estado.diario_activo ? "Automático: encendido" : "Automático: apagado"}
              </button>
              <button type="button" disabled={ocupado}
                      onClick={() => abrir({ proceso: "diario", titulo: "Cierres de hoy", cuerpo: {} })}
                      className="min-h-[44px] rounded-lg px-4 font-bold text-white disabled:opacity-40"
                      style={{ background: "#2c2c2a" }}>
                Ejecutar ahora
              </button>
            </div>
          </section>

          {estado.temporadas.length === 0 ? (
            <section className="mt-4 rounded-xl border p-4" style={{ borderColor: "#303030" }}>
              <h2 className="font-bold text-white">Aún no hay temporadas</h2>
              <p className="mt-1" style={{ color: "#898781" }}>
                Crea la pretemporada (hasta diciembre, no cuenta) y la temporada 1 (enero–diciembre
                de 2027) con sus jornadas.
              </p>
              <button type="button" disabled={ocupado}
                      onClick={() => abrir({ proceso: "temporadas", titulo: "Crear temporadas", cuerpo: {} })}
                      className="mt-3 min-h-[44px] rounded-lg px-4 font-bold text-white disabled:opacity-40"
                      style={{ background: "#3987e5" }}>
                Ver qué se crearía
              </button>
            </section>
          ) : estado.temporadas.map((t) => (
            <section key={t.id} className="mt-4">
              <h2 className="font-bold text-white">
                {t.nombre} <span className="font-normal" style={{ color: "#898781" }}>
                  · {t.cuenta ? "cuenta" : "no cuenta"} · {t.estado}</span>
              </h2>
              <ul className="mt-2 border-t" style={{ borderColor: "#303030" }}>
                {t.jornadas.map((j) => (
                  <li key={j.id} className="border-b py-3" style={{ borderColor: "#303030" }}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-white">
                        {j.numero}. {MES.format(new Date(j.dia_inicio))}
                      </span>
                      <span style={{ color: j.estado === "cerrada" ? "#898781" : j.estado === "formada" ? "#5fb87a" : "#c3c2b7" }}>
                        {j.estado}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[12px]" style={{ color: "#898781" }}>
                      {DIA.format(new Date(j.dia_inicio))}–{DIA.format(new Date(j.dia_fin))}
                      {j.foto_id ? ` · foto ${j.foto_id}` : ""}
                      {j.scan_run_id ? ` · escaneo ${j.scan_run_id}${j.plan_b ? " (plan B)" : ""}` : ""}
                      {j.inscripciones ? ` · ${j.inscripciones} en juego` : ""}
                      {j.sp_rentabilidad != null ? ` · S&P ${j.sp_rentabilidad} %` : ""}
                    </p>
                    {j.siguiente && (
                      <button type="button" disabled={ocupado}
                              onClick={() => abrir({
                                proceso: j.siguiente!, titulo: `${PASO[j.siguiente!]} ${j.numero}`,
                                cuerpo: { jornada_id: j.id },
                              })}
                              className="mt-2 min-h-[40px] rounded-lg px-3 font-bold text-white disabled:opacity-40"
                              style={{ background: "#2c2c2a" }}>
                        {PASO[j.siguiente]}…
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {accion && (
            <section className="mt-5 rounded-xl border p-4" style={{ borderColor: "#3987e5" }}>
              <h2 className="font-bold text-white">{accion.titulo}</h2>
              {ocupado && !previa && <p className="mt-2" style={{ color: "#898781" }}>Preparando la vista previa…</p>}
              {previa != null && hecho == null && (
                <>
                  <p className="mt-2" style={{ color: "#898781" }}>Vista previa: todavía no se ha escrito nada.</p>
                  <Resultado datos={previa} />
                  <div className="mt-3 flex gap-2">
                    <button type="button" onClick={ejecutar} disabled={ocupado}
                            className="min-h-[44px] flex-1 rounded-lg px-4 font-bold text-white disabled:opacity-40"
                            style={{ background: "#3987e5" }}>
                      {ocupado ? "Ejecutando…" : "Ejecutar"}
                    </button>
                    <button type="button" onClick={() => setAccion(null)} disabled={ocupado}
                            className="min-h-[44px] rounded-lg px-4 disabled:opacity-40"
                            style={{ background: "#2c2c2a", color: "#c3c2b7" }}>
                      Cancelar
                    </button>
                  </div>
                </>
              )}
              {hecho != null && (
                <>
                  <p className="mt-2 text-white">Hecho.</p>
                  <Resultado datos={hecho} />
                  <button type="button" onClick={() => setAccion(null)}
                          className="mt-3 min-h-[44px] rounded-lg px-4"
                          style={{ background: "#2c2c2a", color: "#c3c2b7" }}>
                    Cerrar
                  </button>
                </>
              )}
            </section>
          )}

          <section className="mt-6">
            <h2 className="font-bold text-white">Último intento de cada proceso</h2>
            <ul className="mt-2">
              {Object.entries(estado.ultimo_intento).map(([p, i]) => (
                <li key={p} className="flex justify-between gap-2 py-1">
                  <span>{p}</span>
                  <span style={{ color: !i ? "#898781" : i.ok ? "#5fb87a" : "#e66767" }}>
                    {!i ? "nunca" : `${i.ok ? "bien" : "falló"} · ${CUANDO.format(new Date(i.cuando))}`}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}

export default function LigaAdmin() {
  return (
    <AuthGate>
      <Liga />
    </AuthGate>
  );
}
