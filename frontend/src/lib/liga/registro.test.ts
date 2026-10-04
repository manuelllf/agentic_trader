import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { claveValida, completarEnlace } from "./registro";

afterEach(() => vi.unstubAllGlobals());

describe("contraseñas", () => {
  it("exige longitud, mayúscula y símbolo, permitiendo frases y gestores", () => {
    expect(claveValida("Una frase segura!")).toBe(true);
    for (const clave of ["Corta!", "sinmayuscula!", "SinSimbolo123", "Mayuscula ", "A!".repeat(101)]) {
      expect(claveValida(clave)).toBe(false);
    }
  });
});

describe("enlaces", () => {
  function entorno(url: string) {
    const replaceState = vi.fn();
    vi.stubGlobal("window", { location: { href: url }, history: { replaceState } });
    const auth = { verifyOtp: vi.fn().mockResolvedValue({ error: null }),
      setSession: vi.fn().mockResolvedValue({ error: null }) };
    return { auth, sb: { auth } as unknown as SupabaseClient, replaceState };
  }
  it("rechaza un enlace de confirmación en la recuperación y limpia la URL", async () => {
    const { sb, auth, replaceState } = entorno("https://app.example/restablecer#access_token=a&refresh_token=b&type=signup");
    expect(await completarEnlace(sb, "recovery")).toBe(false);
    expect(auth.setSession).not.toHaveBeenCalled();
    expect(replaceState).toHaveBeenCalledWith(null, "", "/restablecer");
  });
  it("valida el token de recuperación con el proveedor", async () => {
    const { sb, auth } = entorno("https://app.example/restablecer?token_hash=temporal&type=recovery");
    expect(await completarEnlace(sb, "recovery")).toBe(true);
    expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: "temporal", type: "recovery" });
  });
  it("no acepta una sesión previa como sustituto de un enlace", async () => {
    const { sb, auth } = entorno("https://app.example/restablecer");
    expect(await completarEnlace(sb, "recovery")).toBe(false);
    expect(auth.setSession).not.toHaveBeenCalled();
  });
});
