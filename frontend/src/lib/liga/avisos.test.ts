// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import * as avisos from "./avisos";

vi.mock("./api", () => ({ llamar: vi.fn() }));
const base: Parameters<typeof avisos.pantallaAvisosAlta>[0] = {
  origen: "confirmar", destino: "/liga", soportado: true, iphoneFuera: false,
  permiso: "default", preguntado: false, suscrito: false,
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("pantallaAvisosAlta", () => {
  it.each<[string, Partial<typeof base>, "avisos" | "ios" | null]>([
    ["alta compatible", {}, "avisos"],
    ["confirmación hacia otra pantalla", { destino: "/completar" }, null],
    ["confirmación excluida antes de iOS", { destino: "/cuenta", soportado: false, iphoneFuera: true }, null],
    ["resto admite otro destino", { origen: "resto", destino: "/cuenta" }, "avisos"],
    ["ya preguntado", { preguntado: true }, null],
    ["ya suscrito", { suscrito: true }, null],
    ["preguntado antes de iOS", { preguntado: true, soportado: false, iphoneFuera: true }, null],
    ["suscrito antes de iOS", { suscrito: true, soportado: false, iphoneFuera: true }, null],
    ["sin soporte", { soportado: false }, null],
    ["iOS sin instalar", { soportado: false, iphoneFuera: true, permiso: "no-disponible" }, "ios"],
    ["iOS antes del permiso denegado", { soportado: false, iphoneFuera: true, permiso: "denied" }, "ios"],
    ["permiso denegado", { permiso: "denied" }, null],
    ["permiso concedido", { permiso: "granted" }, "avisos"],
    ["permiso no disponible", { permiso: "no-disponible" }, "avisos"],
    ["iOS con soporte", { iphoneFuera: true }, "avisos"],
  ])("%s", (_, cambios, resultado) => {
    expect(avisos.pantallaAvisosAlta({ ...base, ...cambios })).toBe(resultado);
  });
});

describe("destinoConAvisos", () => {
  afterEach(() => { delete (navigator as { serviceWorker?: unknown }).serviceWorker; });

  it("devuelve el destino cuando no hay pantalla", async () => {
    vi.stubGlobal("Notification", { permission: "denied" });
    expect(await avisos.destinoConAvisos("resto", "/liga")).toBe("/liga");
  });

  it("manda a la pantalla de avisos cuando la hay", async () => {
    vi.stubGlobal("Notification", { permission: "default" });
    vi.stubGlobal("PushManager", class {});
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { ready: Promise.resolve({ pushManager: { getSubscription: async () => null } }) },
    });
    const destino = "/liga?cartera=uno&vista=dos";
    expect(await avisos.destinoConAvisos("resto", destino)).toBe(
      "/avisos-alta?next=" + encodeURIComponent(destino),
    );
  });
});

it("recuerda la respuesta en este dispositivo", () => {
  expect(avisos.yaPreguntado()).toBe(false);
  avisos.marcarAvisosPreguntados();
  expect(localStorage.getItem("vennett.avisos.preguntado")).toBe("1");
  expect(avisos.yaPreguntado()).toBe(true);
});

it("tolera fallos de lectura y escritura", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("sin almacenamiento"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("sin almacenamiento"); });
  expect(avisos.yaPreguntado()).toBe(false);
  expect(() => avisos.marcarAvisosPreguntados()).not.toThrow();
});

it("tolera que no se pueda acceder a localStorage", () => {
  vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new Error("sin acceso"); });
  expect(avisos.yaPreguntado()).toBe(false);
  expect(() => avisos.marcarAvisosPreguntados()).not.toThrow();
});
