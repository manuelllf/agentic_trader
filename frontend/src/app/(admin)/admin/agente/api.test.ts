// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/liga/supabase", () => ({ tokenSesion: vi.fn() }));
import { tokenSesion } from "@/lib/liga/supabase";
import { AgenteError, getAgente, postAgente } from "./api";

const respuesta = (cuerpo: unknown, estado = 200) =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_AGENTE_API_URL", "https://agente.test/");
  vi.mocked(tokenSesion).mockResolvedValue({ token: "jwt", aal: "aal2", uid: "u" });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetAllMocks(); });

describe("api del agente", () => {
  it("sin URL falla sin llamar a la red", async () => {
    vi.stubEnv("NEXT_PUBLIC_AGENTE_API_URL", "");
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    await expect(getAgente("/v1/hoy")).rejects.toMatchObject({ tipo: "sin_url" });
    expect(f).not.toHaveBeenCalled();
  });

  it("manda el JWT con 2FA y quita la barra final de la URL", async () => {
    const f = vi.fn().mockResolvedValue(respuesta({ ok: 1 }));
    vi.stubGlobal("fetch", f);
    expect(await getAgente("/v1/hoy")).toEqual({ ok: 1 });
    expect(f.mock.calls[0][0]).toBe("https://agente.test/v1/hoy");
    expect(f.mock.calls[0][1].headers.Authorization).toBe("Bearer jwt");
  });

  it("no manda el token si la sesión no tiene el segundo factor", async () => {
    vi.mocked(tokenSesion).mockResolvedValue({ token: "jwt", aal: "aal1", uid: "u" });
    const f = vi.fn().mockResolvedValue(respuesta({}));
    vi.stubGlobal("fetch", f);
    await getAgente("/v1/hoy");
    expect(f.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it("distingue red, sesión caducada y error del servicio", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fallo")));
    await expect(getAgente("/v1/hoy")).rejects.toMatchObject({ tipo: "red" });

    const avisos = vi.fn();
    window.addEventListener("agentic-unauthorized", avisos);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respuesta({}, 401)));
    await expect(getAgente("/v1/hoy")).rejects.toMatchObject({ tipo: "sesion", estado: 401 });
    expect(avisos).toHaveBeenCalledTimes(1);
    window.removeEventListener("agentic-unauthorized", avisos);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respuesta({}, 404)));
    const e = await getAgente("/v1/informes/9").catch(x => x);
    expect(e).toBeInstanceOf(AgenteError);
    expect(e).toMatchObject({ tipo: "http", estado: 404 });
  });

  it("postAgente envía el cuerpo como JSON", async () => {
    const f = vi.fn().mockResolvedValue(respuesta({ parada: true }));
    vi.stubGlobal("fetch", f);
    await postAgente("/v1/control/parada", { parada: true, motivo: "x" });
    expect(f.mock.calls[0][1].method).toBe("POST");
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ parada: true, motivo: "x" });
  });
});
