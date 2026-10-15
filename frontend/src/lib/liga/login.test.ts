import { describe, expect, it } from "vitest";
import { mensajeErrorLogin } from "./login";
import es from "../../../messages/es/auth.json";
import en from "../../../messages/en/auth.json";

describe.each([es, en])("errores de login", (mensajes) => {
  const t = (clave: string) => mensajes[clave as keyof typeof mensajes];
  it("explica la falta de confirmacion solo para su codigo", () => {
    expect(mensajeErrorLogin({ code: "email_not_confirmed", status: 400 }, t))
      .toBe(mensajes.auth_correo_sin_confirmar);
  });
  it("conserva el error de credenciales y los demas errores", () => {
    for (const code of ["invalid_credentials", "otro", undefined]) {
      expect(mensajeErrorLogin({ code, status: 400 }, t)).toBe(mensajes.auth_credenciales_incorrectas);
    }
    expect(mensajeErrorLogin({ status: 429 }, t)).toBe(mensajes.auth_muchos_intentos);
    expect(mensajeErrorLogin(null, t)).toBeNull();
  });
});
