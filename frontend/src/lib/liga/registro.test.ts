import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { claveValida, requisitosClave, completarEnlace, confirmarAlta } from "./registro";

afterEach(() => vi.unstubAllGlobals());

describe("contraseñas", () => {
  it("desglosa los requisitos con Unicode y cuenta caracteres completos", () => {
    expect(requisitosClave("Ábcdefg!")).toEqual({ longitud: true, mayuscula: true, simbolo: true });
    expect(requisitosClave("abcdefg ")).toEqual({ longitud: true, mayuscula: false, simbolo: false });
    expect(requisitosClave("A😀aaaaa")).toEqual({ longitud: false, mayuscula: true, simbolo: true });
    expect(requisitosClave("A!".repeat(101)).longitud).toBe(true);
    expect(claveValida("A!".repeat(101))).toBe(false);
  });
  it("exige longitud, mayúscula y símbolo, permitiendo frases y gestores", () => {
    expect(claveValida("Una frase segura!")).toBe(true);
    for (const clave of ["Corta!", "sinmayuscula!", "SinSimbolo123", "Mayuscula ", "A!".repeat(101)]) {
      expect(claveValida(clave)).toBe(false);
    }
  });
});

describe("enlaces", () => {
  function entorno(url: string, sesion: object | null = null) {
    const replaceState = vi.fn();
    vi.stubGlobal("window", { location: { href: url }, history: { replaceState } });
    const auth = { verifyOtp: vi.fn().mockResolvedValue({ error: null }),
      setSession: vi.fn().mockResolvedValue({ error: null }),
      exchangeCodeForSession: vi.fn().mockResolvedValue({ error: null }),
      getSession: vi.fn().mockResolvedValue({ data: { session: sesion } }) };
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

  describe("confirmación del alta", () => {
    it("abre la sesión con los tokens del fragmento", async () => {
      const { sb, auth, replaceState } = entorno(
        "https://app.example/confirmar#access_token=a&refresh_token=b&expires_in=3600&type=signup");
      expect(await completarEnlace(sb, "signup")).toBe(true);
      expect(auth.setSession).toHaveBeenCalledWith({ access_token: "a", refresh_token: "b" });
      expect(replaceState).toHaveBeenCalledWith(null, "", "/confirmar");
    });
    it("no abre sesión con un fragmento que no es de confirmación", async () => {
      const { sb, auth } = entorno("https://app.example/confirmar#access_token=a&refresh_token=b&type=recovery");
      expect(await completarEnlace(sb, "signup")).toBe(false);
      expect(auth.setSession).not.toHaveBeenCalled();
    });
    it("no da por buena la confirmación si el proveedor rechaza los tokens", async () => {
      const { sb, auth } = entorno("https://app.example/confirmar#access_token=a&refresh_token=b&type=signup");
      auth.setSession.mockResolvedValue({ error: new Error("token no válido") });
      expect(await completarEnlace(sb, "signup")).toBe(false);
    });
    it.each(["signup", "email"])("valida con el proveedor el token_hash de tipo %s", async (tipo) => {
      const { sb, auth } = entorno(`https://app.example/confirmar?token_hash=temporal&type=${tipo}`);
      expect(await completarEnlace(sb, "signup")).toBe(true);
      expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: "temporal", type: tipo });
    });
    it("rechaza un token_hash de otro tipo sin llamar al proveedor", async () => {
      const { sb, auth } = entorno("https://app.example/confirmar?token_hash=temporal&type=recovery");
      expect(await completarEnlace(sb, "signup")).toBe(false);
      expect(auth.verifyOtp).not.toHaveBeenCalled();
    });
    it("en la recuperación solo vale el tipo recovery", async () => {
      const { sb, auth } = entorno("https://app.example/restablecer?token_hash=temporal&type=email");
      expect(await completarEnlace(sb, "recovery")).toBe(false);
      expect(auth.verifyOtp).not.toHaveBeenCalled();
    });
    it("cambia el code de PKCE por una sesión y limpia la URL", async () => {
      const { sb, auth, replaceState } = entorno("https://app.example/confirmar?code=abc-123");
      expect(await completarEnlace(sb, "signup")).toBe(true);
      expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("abc-123");
      expect(replaceState).toHaveBeenCalledWith(null, "", "/confirmar");
    });
    it("no da por buena la confirmación si el code no se puede canjear", async () => {
      const { sb, auth } = entorno("https://app.example/confirmar?code=abc-123");
      auth.exchangeCodeForSession.mockResolvedValue({ error: new Error("sin verificador") });
      expect(await completarEnlace(sb, "signup")).toBe(false);
    });
    it.each([
      "https://app.example/confirmar#error=access_denied&error_code=otp_expired",
      "https://app.example/confirmar?error=access_denied&error_code=otp_expired",
    ])("un enlace con error (%s) no toca la sesión", async (url) => {
      const { sb, auth } = entorno(url);
      expect(await completarEnlace(sb, "signup")).toBe(false);
      expect(auth.setSession).not.toHaveBeenCalled();
      expect(auth.verifyOtp).not.toHaveBeenCalled();
      expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
    });
  });
});

describe("confirmarAlta", () => {
  function entorno(url: string, sesion: object | null) {
    vi.stubGlobal("window", { location: { href: url }, history: { replaceState: vi.fn() } });
    const auth = { verifyOtp: vi.fn().mockResolvedValue({ error: null }),
      setSession: vi.fn().mockResolvedValue({ error: null }),
      exchangeCodeForSession: vi.fn().mockResolvedValue({ error: null }),
      getSession: vi.fn().mockResolvedValue({ data: { session: sesion } }) };
    return { auth, sb: { auth } as unknown as SupabaseClient };
  }
  const enlace = "https://app.example/confirmar#access_token=a&refresh_token=b&type=signup";

  it("confirma con un enlace válido sin preguntar por la sesión", async () => {
    const { sb, auth } = entorno(enlace, null);
    expect(await confirmarAlta(sb)).toBe("confirmada");
    expect(auth.getSession).not.toHaveBeenCalled();
  });
  it("sin enlace válido y sin sesión dice que el enlace no vale", async () => {
    const { sb } = entorno("https://app.example/confirmar", null);
    expect(await confirmarAlta(sb)).toBe("invalido");
  });
  it("sin enlace válido pero con sesión (recarga o enlace repetido) deja entrar", async () => {
    const { sb } = entorno("https://app.example/confirmar", { user: { id: "u" } });
    expect(await confirmarAlta(sb)).toBe("con-sesion");
  });
  it("un enlace caducado con la sesión ya puesta deja entrar", async () => {
    const { sb } = entorno("https://app.example/confirmar#error=access_denied&error_code=otp_expired",
      { user: { id: "u" } });
    expect(await confirmarAlta(sb)).toBe("con-sesion");
  });
  it("si el proveedor falla al canjear, no rompe: lo trata como enlace inválido", async () => {
    const { sb, auth } = entorno("https://app.example/confirmar?code=abc", null);
    auth.exchangeCodeForSession.mockRejectedValue(new Error("sin red"));
    expect(await confirmarAlta(sb)).toBe("invalido");
  });
  it("si tampoco se puede leer la sesión, lo trata como enlace inválido", async () => {
    const { sb, auth } = entorno("https://app.example/confirmar", null);
    auth.getSession.mockRejectedValue(new Error("sin almacenamiento"));
    expect(await confirmarAlta(sb)).toBe("invalido");
  });
});
