"use client";

// Admin: detalle de un usuario — roles, plan, suspensión, saldo y créditos (plan §5.2/§16).
// Cada escritura pasa por su confirmación; los mensajes de error son los que manda la API.

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import AuthGate from "@/components/AuthGate";
import { ApiError, get, post } from "@/lib/api";

type UsuarioDetalle = {
  id: string; alias: string; roles: string[]; plan: "gratis" | "pro"; plan_hasta: string | null;
  suspendido: boolean; creado: string; oculto: boolean; saldo: string;
};
type ResumenVisitas = {
  visitas: number; ultima_visita: string | null; ultima_actividad: string | null;
};
type HistorialVisitas = {
  total: number; filas: { inicio: string; ultima_actividad: string }[];
};
type Movimiento = { id: number; usuario_id: string; importe: string; motivo: string; creado: string;
                    creado_por: string | null };
type ListaMovimientos = { total: number; filas: Movimiento[] };

const ROLES = ["usuario", "moderador", "admin"] as const;
const error = (e: unknown) => (e instanceof ApiError ? e.message : "Algo falló. Reintenta.");
const FECHA = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", year: "numeric" });
const FECHA_HORA = new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short" });

function Detalle() {
  const { id } = useParams<{ id: string }>();
  const [u, setU] = useState<UsuarioDetalle | null>(null);
  const [movs, setMovs] = useState<ListaMovimientos | null>(null);
  const [visitas, setVisitas] = useState<ResumenVisitas | null>(null);
  const [historial, setHistorial] = useState<HistorialVisitas | null>(null);
  const [visitasDesde, setVisitasDesde] = useState(0);
  const [visitasFallo, setVisitasFallo] = useState(false);
  const [fallo, setFallo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [hasta, setHasta] = useState("");
  const [importe, setImporte] = useState("");
  const [motivo, setMotivo] = useState<"regalo" | "ajuste">("regalo");

  const cargar = useCallback(() => {
    setFallo("");
    setVisitas(null); setVisitasFallo(false);
    setHistorial(null);
    get<UsuarioDetalle>(`/liga/admin/usuarios/${id}`).then(setU).catch((e) => setFallo(error(e)));
    get<ListaMovimientos>(`/liga/admin/creditos?usuario_id=${id}&cuantos=20`)
      .then(setMovs).catch((e) => setFallo(error(e)));
    get<ResumenVisitas>(`/liga/admin/usuarios/${id}/visitas`)
      .then(setVisitas).catch(() => setVisitasFallo(true));
    get<HistorialVisitas>(`/liga/admin/usuarios/${id}/visitas/historial?desde=${visitasDesde}&cuantos=10`)
      .then(setHistorial).catch(() => setVisitasFallo(true));
  }, [id, visitasDesde]);
  useEffect(cargar, [cargar]);

  const conFallo = async (accion: () => Promise<unknown>) => {
    setOcupado(true); setFallo("");
    try { await accion(); cargar(); } catch (e) { setFallo(error(e)); } finally { setOcupado(false); }
  };

  const cambiarRol = (rol: string, conceder: boolean) => {
    if (!window.confirm(`¿${conceder ? "Conceder" : "Quitar"} el rol «${rol}»?`)) return;
    void conFallo(() => post(`/liga/admin/usuarios/${id}/rol`, { rol, conceder }));
  };

  const darPro = () => {
    if (!window.confirm(hasta ? `¿Dar Pro hasta ${hasta}?` : "¿Dar Pro sin fecha de fin?")) return;
    void conFallo(() =>
      post(`/liga/admin/usuarios/${id}/plan`, { hasta: hasta ? new Date(hasta).toISOString() : null }));
  };

  const quitarPro = () => {
    if (!window.confirm("¿Quitar el plan Pro?")) return;
    void conFallo(() => post(`/liga/admin/usuarios/${id}/plan/quitar`, {}));
  };

  const suspender = () => {
    if (!u) return;
    const nuevo = !u.suspendido;
    if (!window.confirm(nuevo ? "¿Suspender a este usuario?" : "¿Reactivarlo?")) return;
    void conFallo(() => post(`/liga/admin/usuarios/${id}/suspender`, { suspendido: nuevo }));
  };

  const darCreditos = (e: React.FormEvent) => {
    e.preventDefault();
    if (!importe || Number(importe) <= 0) { setFallo("Pon un importe mayor que cero."); return; }
    if (!window.confirm(`¿Dar ${importe} créditos (${motivo})?`)) return;
    void conFallo(async () => {
      await post("/liga/admin/creditos", {
        usuario_id: id, importe, motivo, idempotencia: crypto.randomUUID(),
      });
      setImporte("");
    });
  };

  return (
    <main className="mx-auto max-w-md px-4 pb-16 pt-6 text-[13px]" style={{ color: "#c3c2b7" }}>
      <Link href="/admin/liga/usuarios" className="text-[12.5px]" style={{ color: "#898781" }}>
        ← Usuarios
      </Link>

      {fallo && <p className="mt-3 rounded-lg p-3" style={{ background: "#2a1616", color: "#e66767" }}>{fallo}</p>}
      {!u ? (
        !fallo && <p className="mt-6" style={{ color: "#898781" }}>Cargando…</p>
      ) : (
        <>
          <h1 className="mt-3 text-[19px] text-white"
              style={{ fontFamily: "var(--font-land-serif)", fontStyle: "italic" }}>{u.alias}</h1>
          <p className="mt-1" style={{ color: "#898781" }}>
            Desde {FECHA.format(new Date(u.creado))} · saldo {u.saldo} créditos
            {u.oculto ? " · oculto" : ""}
          </p>

          <section className="mt-4 rounded-xl border p-4" style={{ borderColor: "#303030" }}>
            <h2 className="font-bold text-white">Actividad</h2>
            {visitas ? (
              <div className="mt-2 space-y-1" style={{ color: "#898781" }}>
                <p><span className="text-white">{visitas.visitas}</span> visitas</p>
                <p>Última visita: {visitas.ultima_visita
                  ? FECHA.format(new Date(visitas.ultima_visita)) : "Sin visitas"}</p>
                <p>Última actividad: {visitas.ultima_actividad
                  ? FECHA_HORA.format(new Date(visitas.ultima_actividad))
                  : "Sin actividad"}</p>
                {historial && (
                  <>
                    <ul className="mt-3 border-t" style={{ borderColor: "#303030" }}>
                      {historial.filas.map((v) => (
                        <li key={v.inicio} className="border-b py-2" style={{ borderColor: "#303030" }}>
                          <p className="text-white">Entrada: {FECHA_HORA.format(new Date(v.inicio))}</p>
                          <p>Última actividad: {FECHA_HORA.format(new Date(v.ultima_actividad))}</p>
                        </li>
                      ))}
                      {historial.filas.length === 0 && <li className="py-2">Sin historial.</li>}
                    </ul>
                    {historial.total > 10 && (
                      <div className="mt-2 flex justify-between">
                        <button type="button" disabled={visitasDesde === 0}
                                onClick={() => setVisitasDesde(Math.max(0, visitasDesde - 10))}
                                className="min-h-[36px] rounded px-2 disabled:opacity-40"
                                style={{ background: "#2c2c2a", color: "#c3c2b7" }}>
                          Anterior
                        </button>
                        <span>{visitasDesde + 1}–{Math.min(visitasDesde + 10, historial.total)} / {historial.total}</span>
                        <button type="button" disabled={visitasDesde + 10 >= historial.total}
                                onClick={() => setVisitasDesde(visitasDesde + 10)}
                                className="min-h-[36px] rounded px-2 disabled:opacity-40"
                                style={{ background: "#2c2c2a", color: "#c3c2b7" }}>
                          Siguiente
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            ) : (
              <p className="mt-2" style={{ color: "#898781" }}>
                {visitasFallo ? "No se pudo cargar la actividad." : "Cargando actividad…"}
              </p>
            )}
          </section>

          <section className="mt-5 rounded-xl border p-4" style={{ borderColor: "#303030" }}>
            <h2 className="font-bold text-white">Roles</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {ROLES.map((rol) => {
                const tiene = u.roles.includes(rol);
                return (
                  <button key={rol} type="button" disabled={ocupado}
                          onClick={() => cambiarRol(rol, !tiene)}
                          className="min-h-[40px] rounded-lg px-3 font-bold disabled:opacity-40"
                          style={{ background: tiene ? "#1f5f3a" : "#2c2c2a",
                                   color: tiene ? "#9be0b3" : "#c3c2b7" }}>
                    {rol}{tiene ? " ✓" : ""}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="mt-4 rounded-xl border p-4" style={{ borderColor: "#303030" }}>
            <h2 className="font-bold text-white">Plan</h2>
            <p className="mt-1" style={{ color: "#898781" }}>
              {u.plan === "pro" ? `Pro${u.plan_hasta ? ` hasta ${FECHA.format(new Date(u.plan_hasta))}` : " (sin fecha de fin)"}` : "Gratis"}
            </p>
            {u.plan !== "pro" ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)}
                       className="min-h-[44px] rounded-lg border px-3 text-white"
                       style={{ background: "#141413", borderColor: "#303030" }} />
                <button type="button" disabled={ocupado} onClick={darPro}
                        className="min-h-[44px] rounded-lg px-4 font-bold text-white disabled:opacity-40"
                        style={{ background: "#3987e5" }}>
                  Dar Pro
                </button>
              </div>
            ) : (
              <button type="button" disabled={ocupado} onClick={quitarPro}
                      className="mt-3 min-h-[44px] rounded-lg px-4 font-bold text-white disabled:opacity-40"
                      style={{ background: "#2c2c2a" }}>
                Volver a gratis
              </button>
            )}
          </section>

          <section className="mt-4 rounded-xl border p-4" style={{ borderColor: "#303030" }}>
            <h2 className="font-bold text-white">Cuenta</h2>
            <button type="button" disabled={ocupado} onClick={suspender}
                    className="mt-3 min-h-[44px] rounded-lg px-4 font-bold text-white disabled:opacity-40"
                    style={{ background: u.suspendido ? "#1f5f3a" : "#7a2020" }}>
              {u.suspendido ? "Reactivar" : "Suspender"}
            </button>
          </section>

          <section className="mt-4 rounded-xl border p-4" style={{ borderColor: "#303030" }}>
            <h2 className="font-bold text-white">Dar créditos</h2>
            <form onSubmit={darCreditos} className="mt-3 flex flex-wrap items-center gap-2">
              <input type="number" min="0.01" step="0.01" value={importe}
                     onChange={(e) => setImporte(e.target.value)} placeholder="Importe"
                     className="min-h-[44px] w-28 rounded-lg border px-3 text-white"
                     style={{ background: "#141413", borderColor: "#303030" }} />
              <select value={motivo} onChange={(e) => setMotivo(e.target.value as "regalo" | "ajuste")}
                      className="min-h-[44px] rounded-lg border px-3 text-white"
                      style={{ background: "#141413", borderColor: "#303030" }}>
                <option value="regalo">Regalo</option>
                <option value="ajuste">Ajuste</option>
              </select>
              <button type="submit" disabled={ocupado}
                      className="min-h-[44px] rounded-lg px-4 font-bold text-white disabled:opacity-40"
                      style={{ background: "#3987e5" }}>
                Dar
              </button>
            </form>

            {movs && (
              <ul className="mt-4 border-t" style={{ borderColor: "#303030" }}>
                {movs.filas.map((m) => (
                  <li key={m.id} className="flex justify-between gap-2 border-b py-2"
                      style={{ borderColor: "#303030" }}>
                    <span>{m.motivo}</span>
                    <span className="text-white">{m.importe}</span>
                    <span style={{ color: "#898781" }}>{FECHA.format(new Date(m.creado))}</span>
                  </li>
                ))}
                {movs.filas.length === 0 && <li className="py-2" style={{ color: "#898781" }}>Sin movimientos.</li>}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}

export default function UsuarioDetalleAdmin() {
  return (
    <AuthGate>
      <Detalle />
    </AuthGate>
  );
}
