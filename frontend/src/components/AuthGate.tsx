"use client";

// Candado de acceso: envuelve TODA la app en el layout raíz, así protege cualquier ruta —
// tanto la home como /real, y da igual que entres por un enlace, una redirección o pegando
// la URL a pelo: sin sesión válida solo se ve el login. La seguridad real está en el backend
// (require_auth); esto es la capa de UX que muestra el login en vez de la app.

import { useEffect, useState } from "react";
import { checkAuth, login } from "@/lib/api";
import Logo from "@/components/Logo";

type State = "checking" | "in" | "out";

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>("checking");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    checkAuth().then((ok) => alive && setState(ok ? "in" : "out"));
    // Si una llamada devuelve 401 (token caducado), volvemos al login sin recargar.
    const onUnauth = () => setState("out");
    window.addEventListener("agentic-unauthorized", onUnauth);
    return () => { alive = false; window.removeEventListener("agentic-unauthorized", onUnauth); };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pw || busy) return;
    setBusy(true); setErr("");
    try {
      await login(pw);
      setPw("");
      setState("in");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo iniciar sesión.");
    } finally {
      setBusy(false);
    }
  };

  if (state === "in") return <>{children}</>;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4"
         style={{ background: "#0d0d0d", color: "#c3c2b7" }}>
      <div className="w-full max-w-xs">
        <div className="mb-6 text-center">
          <Logo size={48} className="mx-auto mb-3" />
          <h1 className="text-[15px] font-bold tracking-tight" style={{ color: "#fff" }}>Agentic Trader</h1>
          <p className="mt-1 text-[11.5px]" style={{ color: "#898781" }}>Acceso privado</p>
        </div>

        {state === "checking" ? (
          <div className="flex items-center justify-center gap-2 py-4 text-[12px]" style={{ color: "#898781" }}>
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2"
                  style={{ borderColor: "#2c2c2a", borderTopColor: "#898781" }} />
            Comprobando sesión…
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-2.5">
            <input
              type="password" value={pw} onChange={(e) => setPw(e.target.value)}
              placeholder="Contraseña" autoFocus autoComplete="current-password"
              className="w-full rounded-lg px-3 py-2.5 text-[13px] outline-none"
              style={{ background: "#1a1a19", border: "1px solid #2c2c2a", color: "#fff" }}
              onFocus={(e) => (e.currentTarget.style.borderColor = "#3987e5")}
              onBlur={(e) => (e.currentTarget.style.borderColor = "#2c2c2a")}
            />
            {err && <p className="text-[11.5px]" style={{ color: "#e66767" }}>{err}</p>}
            <button
              type="submit" disabled={busy || !pw}
              className="w-full rounded-lg px-3 py-2.5 text-[13px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{ background: "#3987e5" }}
            >
              {busy ? "Entrando…" : "Entrar"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
