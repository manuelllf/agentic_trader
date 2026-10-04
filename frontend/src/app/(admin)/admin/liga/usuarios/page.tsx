"use client";

// Admin: buscar usuarios por alias, paginado (plan §5.2/§11). Cada fila lleva al detalle, donde
// están los roles, el plan, el saldo y las escrituras.

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import AuthGate from "@/components/AuthGate";
import { ApiError, get, post } from "@/lib/api";

type Alta = {
  id: string; email: string; alias: string; alias_aplicado: boolean; clave_temporal: string;
};

// Alta a mano: crea la cuenta ya confirmada y enseña la contraseña temporal una sola vez.
function AltaUsuario({ onAlta }: { onAlta: () => void }) {
  const t = useTranslations();
  const [abierto, setAbierto] = useState(false);
  const [email, setEmail] = useState("");
  const [alias, setAlias] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [fallo, setFallo] = useState("");
  const [alta, setAlta] = useState<Alta | null>(null);
  const [copiado, setCopiado] = useState(false);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (ocupado) return;
    setOcupado(true); setFallo("");
    try {
      const res = await post<Alta>("/liga/admin/usuarios", { email, alias: alias.trim() || null });
      setAlta(res); setCopiado(false); setEmail(""); setAlias("");
      onAlta();
    } catch (err) {
      setFallo(err instanceof ApiError ? err.message : t("admin_generic_error"));
    } finally {
      setOcupado(false);
    }
  };

  const copiar = async () => {
    if (!alta) return;
    try {
      await navigator.clipboard.writeText(`${alta.email}\n${alta.clave_temporal}`);
      setCopiado(true);
    } catch { /* sin portapapeles: se copia a mano */ }
  };

  if (!abierto) {
    return (
      <button type="button" onClick={() => setAbierto(true)}
              className="mt-4 min-h-[44px] w-full rounded-lg px-4 font-bold text-white"
              style={{ background: "#3987e5" }}>
        {t("admin_users_create")}
      </button>
    );
  }
  return (
    <section className="mt-4 rounded-lg border p-3" style={{ borderColor: "#303030" }}>
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] text-white">{t("admin_users_create")}</h2>
        <button type="button" onClick={() => { setAbierto(false); setAlta(null); setFallo(""); }}
                className="min-h-[44px] px-2" style={{ color: "#898781" }}>{t("admin_users_close")}</button>
      </div>
      <form onSubmit={enviar} className="mt-2 flex flex-col gap-2">
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
               placeholder={t("admin_users_email")} autoCapitalize="none" autoCorrect="off" spellCheck={false}
               className="min-h-[44px] rounded-lg border px-3 text-white"
               style={{ background: "#141413", borderColor: "#303030" }} />
        <input value={alias} onChange={(e) => setAlias(e.target.value)} maxLength={20}
               placeholder={t("admin_users_league_name")} autoCapitalize="none"
               autoCorrect="off" spellCheck={false}
               className="min-h-[44px] rounded-lg border px-3 text-white"
               style={{ background: "#141413", borderColor: "#303030" }} />
        <button type="submit" disabled={ocupado || !email}
                className="min-h-[44px] rounded-lg px-4 font-bold text-white disabled:opacity-40"
                style={{ background: "#3987e5" }}>
          {ocupado ? t("admin_users_creating") : t("admin_users_create_account")}
        </button>
      </form>
      {fallo && <p className="mt-3 rounded-lg p-3" style={{ background: "#2a1616", color: "#e66767" }}>{fallo}</p>}
      {alta && (
        <div className="mt-3 rounded-lg p-3" style={{ background: "#12261a", color: "#9be0b3" }}>
          <p>{t("admin_users_created_notice")}</p>
          <p className="mt-2 break-all text-white">{alta.email}</p>
          <p className="break-all text-white" style={{ fontFamily: "monospace" }}>{alta.clave_temporal}</p>
          {!alta.alias_aplicado && (
            <p className="mt-2" style={{ color: "#e6c067" }}>
              {t("admin_users_alias_invalid", { alias: alta.alias })}
            </p>
          )}
          <p className="mt-2">{t("admin_users_change_password")}</p>
          <button type="button" onClick={copiar}
                  className="mt-2 min-h-[44px] rounded-lg px-4"
                  style={{ background: "#2c2c2a", color: "#c3c2b7" }}>
            {copiado ? t("admin_users_copied") : t("admin_users_copy_credentials")}
          </button>
        </div>
      )}
    </section>
  );
}

type UsuarioFila = {
  id: string; alias: string; roles: string[]; plan: "gratis" | "pro";
  plan_hasta: string | null; suspendido: boolean; creado: string;
};
type ListaUsuarios = { total: number; filas: UsuarioFila[] };

const CUANTOS = 50;
const error = (e: unknown) => (e instanceof ApiError ? e.message : "Algo falló. Reintenta.");

function Usuarios() {
  const t = useTranslations();
  const locale = useLocale();
  const [alias, setAlias] = useState("");
  const [buscando, setBuscando] = useState("");
  const [desde, setDesde] = useState(0);
  const [lista, setLista] = useState<ListaUsuarios | null>(null);
  const [fallo, setFallo] = useState("");
  const [cargando, setCargando] = useState(false);

  // Solo vale la última petición lanzada: una respuesta lenta anterior no pisa a la nueva.
  const ultima = useRef(0);
  const cargar = useCallback((a: string, d: number) => {
    setCargando(true); setFallo("");
    const n = ++ultima.current;
    const q = new URLSearchParams({ alias: a, desde: String(d), cuantos: String(CUANTOS) });
    get<ListaUsuarios>(`/liga/admin/usuarios?${q.toString()}`)
      .then((r) => { if (n === ultima.current) setLista(r); })
      .catch((e) => { if (n === ultima.current) setFallo(e instanceof ApiError ? e.message : t("admin_generic_error")); })
      .finally(() => { if (n === ultima.current) setCargando(false); });
  }, [t]);

  useEffect(() => { cargar(buscando, desde); }, [cargar, buscando, desde]);

  const buscar = (e: React.FormEvent) => {
    e.preventDefault();
    setDesde(0); setBuscando(alias.trim());
  };

  return (
    <main className="mx-auto max-w-md px-4 pb-16 pt-6 text-[13px]" style={{ color: "#c3c2b7" }}>
      <Link href="/admin/liga" className="text-[12.5px]" style={{ color: "#898781" }}>{t("admin_back_vennett")}</Link>
      <h1 className="mt-3 text-[19px] text-white"
          style={{ fontFamily: "var(--font-land-serif)", fontStyle: "italic" }}>{t("admin_users_title")}</h1>

      <AltaUsuario onAlta={() => cargar(buscando, desde)} />

      <form onSubmit={buscar} className="mt-4 flex gap-2">
        <input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder={t("admin_users_search_placeholder")}
               className="min-h-[44px] flex-1 rounded-lg border px-3 text-white"
               style={{ background: "#141413", borderColor: "#303030" }} />
        <button type="submit"
                className="min-h-[44px] rounded-lg px-4 font-bold text-white"
                style={{ background: "#3987e5" }}>
          {t("admin_users_search")}
        </button>
      </form>

      {fallo && <p className="mt-3 rounded-lg p-3" style={{ background: "#2a1616", color: "#e66767" }}>{fallo}</p>}
      {cargando && !lista && <p className="mt-6" style={{ color: "#898781" }}>{t("admin_loading")}</p>}

      {lista && (
        <>
          <p className="mt-4" style={{ color: "#898781" }}>{t("admin_users_count", { count: new Intl.NumberFormat(locale).format(lista.total) })}</p>
          <ul className="mt-2 border-t" style={{ borderColor: "#303030" }}>
            {lista.filas.map((u) => (
              <li key={u.id} className="border-b" style={{ borderColor: "#303030" }}>
                <Link href={`/admin/liga/usuarios/${u.id}`}
                      className="flex min-h-[56px] items-center justify-between gap-2 py-2">
                  <span>
                    <span className="text-white">{u.alias}</span>
                    {u.suspendido && (
                      <span className="ml-2 rounded px-1.5 py-0.5 text-[11px]"
                            style={{ background: "#2a1616", color: "#e66767" }}>{t("admin_users_suspended")}</span>
                    )}
                    {u.plan === "pro" && (
                      <span className="ml-2 rounded px-1.5 py-0.5 text-[11px]"
                            style={{ background: "#1f5f3a", color: "#9be0b3" }}>{t("admin_users_pro")}</span>
                    )}
                  </span>
                  <span style={{ color: "#898781" }}>{u.roles.map((role) => ["usuario", "moderador", "admin"].includes(role) ? t(`admin_user_role_${role}`) : role).join(", ") || t("admin_users_role_user")}</span>
                </Link>
              </li>
            ))}
          </ul>
          {lista.filas.length === 0 && <p className="mt-4" style={{ color: "#898781" }}>{t("admin_users_empty")}</p>}
          <div className="mt-4 flex justify-between gap-2">
            <button type="button" disabled={desde === 0 || cargando}
                    onClick={() => setDesde(Math.max(0, desde - CUANTOS))}
                    className="min-h-[44px] rounded-lg px-4 disabled:opacity-40"
                    style={{ background: "#2c2c2a", color: "#c3c2b7" }}>
              {t("admin_users_previous")}
            </button>
            <button type="button" disabled={desde + CUANTOS >= lista.total || cargando}
                    onClick={() => setDesde(desde + CUANTOS)}
                    className="min-h-[44px] rounded-lg px-4 disabled:opacity-40"
                    style={{ background: "#2c2c2a", color: "#c3c2b7" }}>
              {t("admin_users_next")}
            </button>
          </div>
        </>
      )}
    </main>
  );
}

export default function UsuariosAdmin() {
  return (
    <AuthGate>
      <Usuarios />
    </AuthGate>
  );
}
