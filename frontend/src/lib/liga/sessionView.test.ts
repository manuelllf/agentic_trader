import { describe, expect, it } from "vitest";
import { sessionViewKey } from "./sessionView";

describe("estado del formulario al establecer la sesión", () => {
  it.each(["/entrar", "/registrar"])("conserva %s al aceptar credenciales", pathname => {
    expect(sessionViewKey(pathname, null)).toBe(sessionViewKey(pathname, "usuario-a"));
  });
  it.each(["/cuenta", "/mias", "/crear"])("separa las cuentas en %s", pathname => {
    expect(sessionViewKey(pathname, "usuario-a")).not.toBe(sessionViewKey(pathname, "usuario-b"));
    expect(sessionViewKey(pathname, null)).not.toBe(sessionViewKey(pathname, "usuario-a"));
  });
});
