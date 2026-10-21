"use client";
import { Bloque, Boton } from "../../_marco/ui";
import { dolares, fechaCorta } from "../../_marco/formato";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useConfirmar } from "@/components/Confirmar";
import { ApiError, get, post } from "@/lib/api";
import { Actividad, type Historial as HistorialVisitas } from "./Actividad";
import { CosteIA } from "./CosteIA";
import { LigaEstrategias } from "./LigaEstrategias";
import { Ficha } from "./Ficha";
import type { FichaPanel, DiasPanel } from "./panel";

type UsuarioDetalle = {
  id: string; alias: string; roles: string[]; plan: "gratis" | "pro"; plan_hasta: string | null;
  pase_liga: boolean; pase_hasta: string | null;
  suspendido: boolean; creado: string; oculto: boolean; saldo: string;
};
type Movimiento = { id: number; usuario_id: string; importe: string; motivo: string; creado: string;
                    creado_por: string | null };
type ListaMovimientos = { total: number; filas: Movimiento[] };

const ROLES = ["usuario", "moderador", "admin"] as const;
const error = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

export function DetalleUsuario({ id, volver }: { id: string; volver: string }) {
  const t = useTranslations();
  const router = useRouter();
  const { confirmar, dialogo } = useConfirmar();
  const locale = useLocale();
  const FECHA = { format: (fecha: Date) => fechaCorta(fecha.toISOString(), locale) };
  const rolLabel = (rol: string) => ["usuario", "moderador", "admin"].includes(rol) ? t(`admin_user_role_${rol}`) : rol;
  const errorText = useCallback((e: unknown) => error(e, t("admin_generic_error")), [t]);
  const [u, setU] = useState<UsuarioDetalle | null>(null);
  const [movs, setMovs] = useState<ListaMovimientos | null>(null);
  const [ficha, setFicha] = useState<FichaPanel | null>(null);
  const [dias, setDias] = useState<DiasPanel | null>(null);
  const [historial, setHistorial] = useState<HistorialVisitas | null>(null);
  const [visitasDesde, setVisitasDesde] = useState(0);
  const [fallo, setFallo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [hasta, setHasta] = useState("");
  const [hastaPase, setHastaPase] = useState("");
  const [importe, setImporte] = useState("");
  const [motivo, setMotivo] = useState<"regalo" | "ajuste">("regalo");

  const cargar = useCallback(() => {
    setFallo("");
    get<UsuarioDetalle>(`/liga/admin/usuarios/${id}`).then(setU).catch((e) => setFallo(errorText(e)));
    get<FichaPanel>(`/liga/admin/panel-usuarios/${id}`).then(setFicha).catch((e) => setFallo(errorText(e)));
    get<DiasPanel>(`/liga/admin/panel-usuarios/${id}/dias?n=14`).then(setDias).catch((e) => setFallo(errorText(e)));
    get<ListaMovimientos>(`/liga/admin/creditos?usuario_id=${id}&cuantos=20`).then(setMovs).catch((e) => setFallo(errorText(e)));
    get<HistorialVisitas>(`/liga/admin/usuarios/${id}/visitas/historial?desde=${visitasDesde}&cuantos=10`).then(setHistorial).catch((e) => setFallo(errorText(e)));
  }, [id, visitasDesde, errorText]);
  useEffect(() => { setU(null); setFicha(null); setDias(null); cargar(); }, [cargar]);

  const conFallo = async (accion: () => Promise<unknown>) => {
    setOcupado(true); setFallo("");
    try { await accion(); cargar(); } catch (e) { setFallo(errorText(e)); } finally { setOcupado(false); }
  };

  const cambiarRol = async (rol: string, conceder: boolean) => {
    if (!(await confirmar({ titulo: t(conceder ? "admin_user_confirm_grant_role" : "admin_user_confirm_remove_role", { role: rolLabel(rol) }), aceptar: t("common_confirmar"), peligro: !conceder }))) return;
    void conFallo(() => post(`/liga/admin/usuarios/${id}/rol`, { rol, conceder }));
  };

  const darPro = async () => {
    if (!(await confirmar({ titulo: hasta ? t("admin_user_confirm_pro_until", { date: hasta }) : t("admin_user_confirm_pro_no_end"), aceptar: t("common_confirmar") }))) return;
    void conFallo(() =>
      post(`/liga/admin/usuarios/${id}/plan`, { hasta: hasta ? new Date(hasta).toISOString() : null }));
  };

  const quitarPro = async () => {
    if (!(await confirmar({ titulo: t("admin_user_confirm_remove_pro"), aceptar: t("common_confirmar"), peligro: true }))) return;
    void conFallo(() => post(`/liga/admin/usuarios/${id}/plan/quitar`, {}));
  };

  const darPase = async () => {
    if (!(await confirmar({ titulo: hastaPase ? t("admin_user_confirm_pass_until", { date: hastaPase }) : t("admin_user_confirm_pass_no_end"), aceptar: t("common_confirmar") }))) return;
    void conFallo(() =>
      post(`/liga/admin/usuarios/${id}/pase`, { hasta: hastaPase ? new Date(hastaPase).toISOString() : null }));
  };

  const quitarPase = async () => {
    if (!(await confirmar({ titulo: t("admin_user_confirm_remove_pass"), aceptar: t("common_confirmar"), peligro: true }))) return;
    void conFallo(() => post(`/liga/admin/usuarios/${id}/pase/quitar`, {}));
  };

  const suspender = async () => {
    if (!u) return;
    const nuevo = !u.suspendido;
    if (!(await confirmar({ titulo: t(nuevo ? "admin_user_confirm_suspend" : "admin_user_confirm_reactivate"), aceptar: t("common_confirmar"), peligro: nuevo }))) return;
    void conFallo(() => post(`/liga/admin/usuarios/${id}/suspender`, { suspendido: nuevo }));
  };

  const darCreditos = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importe || Number(importe) <= 0) { setFallo(t("admin_user_amount_positive")); return; }
    if (!(await confirmar({ titulo: t("admin_user_confirm_credits", { amount: importe, reason: t(motivo === "regalo" ? "admin_user_gift" : "admin_user_adjustment") }), aceptar: t("common_confirmar") }))) return;
    void conFallo(async () => {
      await post("/liga/admin/creditos", {
        usuario_id: id, importe, motivo, idempotencia: crypto.randomUUID(),
      });
      setImporte("");
    });
  };

  return (
    <div className="pb-16"><article>
      <Boton variante="texto" className="adm-usuarios-movil" onClick={() => { router.push(volver); }}>{t("admin_user_back")}</Boton>
      {!u || !ficha || !dias ? (
        !fallo && <p className="mt-6">{t("admin_loading")}</p>
      ) : (<>
          <h1 className="mt-3 text-[22px] text-white">{u.alias}</h1>
          <dl>
            <div className="adm-usuarios-par"><dt className="adm-nota">{t("admin_panel_col_joined")}</dt><dd>{fechaCorta(u.creado, locale)}</dd></div>
            <div className="adm-usuarios-par"><dt className="adm-nota">{t("admin_user_balance")}</dt><dd>{dolares(u.saldo, locale)}</dd></div>
          </dl>

          <div className="mt-2 flex flex-wrap gap-2">
            {u.plan === "pro" && <span>{t("admin_users_pro")}</span>}
            {u.roles.map((rol) => <span key={rol}>{rolLabel(rol)}</span>)}
            {u.suspendido && <span>{t("admin_users_suspended")}</span>}
          </div>
          <Actividad actividad={ficha.actividad} dias={dias.dias} historial={historial} desde={visitasDesde} onPagina={setVisitasDesde} />
          <CosteIA ia={ficha.ia} />
          <LigaEstrategias liga={ficha.liga} />
          <Ficha ficha={ficha} />
          <Bloque titulo={t("admin_user_actions")}>
          <section><h3 className="adm-h2">{t("admin_user_plan")}</h3>
            <p className="mt-1">
              {u.plan === "pro" ? (u.plan_hasta ? t("admin_user_pro_until", { date: FECHA.format(new Date(u.plan_hasta)) }) : t("admin_user_pro_no_end")) : t("admin_user_free")}
            </p>
            {u.plan !== "pro" ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)}
                       className="min-h-[44px] rounded-lg border px-3 text-white" />
                <Boton variante="sec" type="button" disabled={ocupado} onClick={darPro}
                        className="min-h-[44px] rounded-lg px-4 font-bold text-white disabled:opacity-40">
                  {t("admin_user_grant_pro")}
                </Boton>
              </div>
            ) : (
              <Boton variante="sec" type="button" disabled={ocupado} onClick={quitarPro}
                      className="mt-3 min-h-[44px] rounded-lg px-4 font-bold text-white disabled:opacity-40">
                {t("admin_user_back_to_free")}
              </Boton>
            )}
          </section>

          <section><h3 className="adm-h2">{t("admin_user_pass")}</h3>
            <p className="mt-1">
              {u.pase_liga ? (u.pase_hasta ? t("admin_user_pass_until", { date: FECHA.format(new Date(u.pase_hasta)) }) : t("admin_user_pass_no_end")) : t("admin_user_pass_none")}
            </p>
            {!u.pase_liga ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input type="date" value={hastaPase} onChange={(e) => setHastaPase(e.target.value)}
                       className="min-h-[44px] rounded-lg border px-3 text-white" />
                <Boton variante="sec" type="button" disabled={ocupado} onClick={darPase}
                        className="min-h-[44px] rounded-lg px-4 font-bold text-white disabled:opacity-40">
                  {t("admin_user_grant_pass")}
                </Boton>
              </div>
            ) : (
              <Boton variante="sec" type="button" disabled={ocupado} onClick={quitarPase}
                      className="mt-3 min-h-[44px] rounded-lg px-4 font-bold text-white disabled:opacity-40">
                {t("admin_user_remove_pass")}
              </Boton>
            )}
          </section>

          <section><h3 className="adm-h2">{t("admin_user_grant_credits")}</h3>
            <form onSubmit={darCreditos} className="mt-3 flex flex-wrap items-center gap-2">
              <input type="number" min="0.01" step="0.01" value={importe}
                     onChange={(e) => setImporte(e.target.value)} placeholder={t("admin_user_amount")}
                     className="min-h-[44px] w-28 rounded-lg border px-3 text-white" />
              <select value={motivo} onChange={(e) => setMotivo(e.target.value as "regalo" | "ajuste")}
                      className="min-h-[44px] rounded-lg border px-3 text-white">
                <option value="regalo">{t("admin_user_gift")}</option>
                <option value="ajuste">{t("admin_user_adjustment")}</option>
              </select>
              <Boton variante="sec" type="submit" disabled={ocupado}
                      className="min-h-[44px] rounded-lg px-4 font-bold text-white disabled:opacity-40">
                {t("admin_user_give")}
              </Boton>
            </form>

            {movs && (
              <ul className="mt-4 border-t">
                {movs.filas.map((m) => (
                  <li key={m.id} className="admin-movimiento admin-par flex justify-between gap-2 border-b py-2">
                    <span>{m.motivo === "regalo" ? t("admin_user_gift") : m.motivo === "ajuste" ? t("admin_user_adjustment") : m.motivo}</span>
                    <span className="text-white">{dolares(m.importe, locale)}</span>
                    <span>{FECHA.format(new Date(m.creado))}</span>
                  </li>
                ))}
                {movs.filas.length === 0 && <li className="py-2">{t("admin_user_movements_empty")}</li>}
              </ul>
            )}
          </section>
          <section><h3 className="adm-h2">{t("admin_user_roles")}</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {ROLES.map((rol) => {
                const tiene = u.roles.includes(rol);
                return (
                  <Boton variante="sec" key={rol} type="button" disabled={ocupado}
                          onClick={() => cambiarRol(rol, !tiene)}
                          className="min-h-[44px] rounded-lg px-3 font-bold disabled:opacity-40">
                    {rolLabel(rol)}{tiene ? " ✓" : ""}
                  </Boton>
                );
              })}
            </div>
          </section>

          <section><h3 className="adm-h2">{t("admin_user_account")}</h3>
            <Boton variante="sec" type="button" disabled={ocupado} onClick={suspender}
                    className="mt-3 min-h-[44px] rounded-lg px-4 font-bold text-white disabled:opacity-40">
              {u.suspendido ? t("admin_user_reactivate") : t("admin_user_suspend")}
            </Boton>
          </section>
          </Bloque>

      </>)}
      {fallo && <p className="mt-3 rounded-lg p-3">{fallo}</p>}
      {dialogo}
    </article></div>
  );
}
