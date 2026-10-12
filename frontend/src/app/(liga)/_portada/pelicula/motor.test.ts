// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { mapa, montarPelicula, paletaDe } from "./motor";
import { crearUniverso } from "./universo";
import { traductor, fijarOcultoDelDocumento, montar, restaurarEntorno } from "./motor.fixture";

// El marcado de `Pelicula` se pinta siempre en español; el idioma del motor se elige en `montar`.
vi.mock("next-intl", async () => {
  const catalogo = (await import("../../../../../messages/es/landing.json")).default as Record<string, string>;
  const t = (clave: string, valores?: Record<string, string | number>) =>
    (catalogo[clave] ?? clave).replace(/\{(\w+)\}/g, (_, n: string) => String(valores?.[n] ?? `{${n}}`));
  return { useTranslations: () => t, useLocale: () => "es" };
});
vi.mock("next/link", async () => {
  const React = await import("react");
  return { default: (p: { href: string; className?: string; children?: unknown }) =>
    React.createElement("a", { href: p.href, className: p.className }, p.children as never) };
});

afterEach(restaurarEntorno);

describe("motor de la portada", () => {
  it("omite los porcentajes que no caben, manteniendo los tickers", () => {
    const normal = montar({ tiempo: 7 });
    normal.reloj.avanzar(0.1);
    expect(normal.llamadas.some((l) => l.metodo === "fillText" && String(l.args[0]).includes("%"))).toBe(true);
    normal.desmontar();
    restaurarEntorno();
    const escena = montar({ tiempo: 7, medirTexto: (texto, fuente) => texto.includes("%") ? 10_000
      : texto.length * parseFloat(fuente.split(" ")[1]) * 0.6 });
    escena.reloj.avanzar(0.1);
    expect(escena.llamadas.some((l) => l.metodo === "fillText" && l.args[0] === "MSFT")).toBe(true);
    expect(escena.llamadas.some((l) => l.metodo === "fillText" && String(l.args[0]).includes("%"))).toBe(false);
    escena.desmontar();
  });

  it("pinta las cabeceras antes y omite tickers que chocan con ellas", () => {
    const escena = montar({ tiempo: 7 });
    escena.reloj.avanzar(0.1);
    const llamadas = escena.llamadas;
    const sectores = traductor("es")("landing_sectores").split("|").map((s) => s.toLocaleUpperCase("es"));
    const cabeceras = llamadas.flatMap((l, i) => l.metodo === "fillText" && sectores.includes(String(l.args[0]))
      ? [llamadas[i - 1].args.map(Number)] : []);
    expect(cabeceras.length).toBeGreaterThan(0);
    const tickers = new Set(crearUniverso().map((e) => e.ticker).filter(Boolean));
    const etiquetas = llamadas.filter((l) => l.metodo === "fillText" && tickers.has(String(l.args[0])));
    const ultimaCabecera = llamadas.findLastIndex((l) => l.metodo === "fillText" && sectores.includes(String(l.args[0])));
    expect(llamadas.indexOf(etiquetas[0])).toBeGreaterThan(ultimaCabecera);
    for (const l of etiquetas) {
      const f = parseFloat(l.font.split(" ")[1]), w = String(l.args[0]).length * f * 0.6;
      const x = Number(l.args[1]) - w / 2, y = Number(l.args[2]) - f / 2;
      expect(cabeceras.some(([sx, sy, sw, sh]) => x < sx + sw && x + w > sx && y < sy + sh && y + f > sy)).toBe(false);
    }
    const dibujados = new Set(etiquetas.map((l) => String(l.args[0])));
    expect(llamadas.some((l) => l.metodo === "measureText" && tickers.has(String(l.args[0])) && !dibujados.has(String(l.args[0])))).toBe(true);
    escena.desmontar();
  });

  it("agrupa las empresas pequeñas por sector y reduce las casillas", () => {
    const empresas = crearUniverso();
    const plano = mapa(empresas, { x: 16, y: 64, w: 358, h: 552 }, 11, 1, empresas.length);
    expect(plano.bloques.flatMap((b) => b.empresas).map((e) => e.id).sort((a, b) => a - b))
      .toEqual(empresas.map((e) => e.id));
    for (const sector of plano.sectores) {
      const grupo = empresas.filter((e) => e.sector === sector.s), peso = grupo.reduce((s, e) => s + e.cap, 0);
      const pequenas = grupo.filter((e) => sector.w * sector.h * e.cap / peso < 40);
      const bloques = plano.bloques.filter((b) => b.empresas[0].sector === sector.s);
      expect(bloques.filter((b) => b.empresas.length > 1)).toHaveLength(1);
      expect(bloques.find((b) => b.empresas.length > 1)!.empresas).toEqual(pequenas);
      for (const bloque of bloques) {
        const pesoBloque = bloque.empresas.reduce((s, e) => s + e.cap, 0);
        expect(bloque.w * bloque.h / (sector.w * sector.h)).toBeCloseTo(pesoBloque / peso, 10);
      }
    }
    const escena = montar({ tiempo: 7 });
    escena.reloj.avanzar(0.1);
    const celdas = escena.llamadas.filter((l) => l.metodo === "fillRect" && Number(l.args[2]) > 0 && Number(l.args[3]) > 0);
    expect(celdas.length).toBeGreaterThan(10);
    expect(celdas.length).toBeLessThan(crearUniverso().length / 2);
    expect(celdas.every((l) => l.args.every((v) => Number.isFinite(Number(v))))).toBe(true);
    escena.desmontar();
  });

  it.each([320, 360, 430])("escala las fuentes del canvas con una escena de %i px", (ancho) => {
    const fuentes = (w: number, tiempo: number) => {
      const escena = montar({ tiempo, ancho: w });
      escena.reloj.avanzar(0.1);
      const tamaños = escena.llamadas.filter((l) => l.metodo === "fillText").map((l) => parseFloat(l.font.split(" ")[1]));
      escena.desmontar();
      restaurarEntorno();
      return tamaños;
    };
    for (const tiempo of [7, 28, 33, 42, 50]) {
      const base = fuentes(390, tiempo), escaladas = fuentes(ancho, tiempo);
      expect(base.length).toBeGreaterThan(0);
      expect(escaladas).toHaveLength(base.length);
      escaladas.forEach((f, i) => expect(f / base[i]).toBeCloseTo(ancho / 390, 6));
    }
  });

  it("el reloj y el contador pertenecen a sus bloques y no se posicionan sobre el mapa", () => {
    const escena = montar({ tiempo: 24.6 });
    escena.reloj.avanzar(0.1);
    expect(escena.pieza("reloj").closest("[data-it]")).toBe(escena.item("cierre"));
    expect(escena.pieza("recuento").closest("[data-it]")).toBe(escena.item("reglas"));
    for (const n of ["reloj", "recuento"]) {
      expect(escena.pieza(n).style.left).toBe("");
      expect(escena.pieza(n).style.top).toBe("");
      expect(escena.pieza(n).style.opacity).toBe("");
    }
    expect(escena.pieza("recuentoL").textContent).toBe(traductor("es")("landing_recuento_reglas"));
    escena.desmontar();
  });

  it("limita el DPR a tres y lo comparte con la textura", () => {
    vi.stubGlobal("devicePixelRatio", 4);
    const escena = montar({ tiempo: 7 });
    expect(escena.pelicula.style.getPropertyValue("--pel-dpr")).toBe("3");
    expect(escena.pieza<HTMLCanvasElement>("lienzo").width).toBe(390 * 3);
    escena.desmontar();
  });

  it("las paletas comparten claves y el suelo sigue el tema", () => {
    const claro = paletaDe("claro"), oscuro = paletaDe("oscuro");
    expect(Object.keys(claro).sort()).toEqual(Object.keys(oscuro).sort());
    expect(claro.suelo).toEqual([255, 255, 255]);
    expect(oscuro.suelo).toEqual([10, 12, 13]);
  });

  it("monta en claro y devuelve la limpieza en una ventana de 390 px", () => {
    const escena = montar({ tiempo: 0.5 });
    escena.limpiar();
    const limpiar = montarPelicula(escena.pelicula, { locale: "es", t: traductor("es") }, "claro");
    expect(typeof limpiar).toBe("function");
    escena.reloj.avanzar(0.1);
    expect(escena.llamadas.some((l) => l.metodo === "fillRect")).toBe(true);
    limpiar();
    expect(escena.reloj.pendientes()).toBe(0);
    escena.desmontar();
  });

  it("monta parado en un segundo, dibuja un fotograma y devuelve la limpieza", () => {
    const escena = montar({ tiempo: 0.5 });
    escena.reloj.avanzar(0.1);
    expect(escena.llamadas.some((l) => l.metodo === "fillRect")).toBe(true);
    expect(typeof escena.limpiar).toBe("function");
    escena.desmontar();
  });

  it("en el segundo 7 la foto cuenta 2.987 empresas y el reloj marca el cierre", () => {
    const escena = montar({ tiempo: 7 });
    escena.reloj.avanzar(0.1);
    expect(escena.pieza("recuentoN").textContent).toBe("2.987");
    expect(escena.pieza("relojTxt").textContent).toBe("Cierre · 16:00 ET");
    escena.desmontar();
  });

  it("en el segundo 24,6 quedan 87 empresas y las cuatro reglas cuentan 876, 438, 268 y 87", () => {
    const escena = montar({ tiempo: 24.6 });
    escena.reloj.avanzar(0.1);
    expect(escena.pieza("recuentoN").textContent).toBe("87");
    const cuentas = escena.piezas("reglaCuenta").map((e) => e.textContent);
    expect(cuentas).toEqual(["876", "438", "268", "87"]);
    escena.desmontar();
  });

  it("el deslizador PER actualiza la cuarta regla, el contador y el texto", () => {
    const escena = montar({ tiempo: 24.6 });
    const per = escena.pieza<HTMLInputElement>("per");
    per.value = "25";
    per.dispatchEvent(new Event("input", { bubbles: true }));
    escena.reloj.avanzar(0.1);
    expect(escena.piezas("reglaCuenta")[3].textContent).toBe("151");
    expect(escena.pieza("recuentoN").textContent).toBe("151");
    expect(escena.pieza("perTxt").textContent).toBe("PER ≤ 25");
    escena.desmontar();
  });

  // Monta la escena cinco veces y pinta unos 1.500 fotogramas completos (7-9 ms cada uno en jsdom):
  // no cabe en los 5 s por defecto, y en el CI aún tarda más.
  it("avanza sin tiempo fijado y se pausa por las condiciones de la escena", { timeout: 30_000 }, () => {
    const inicial = montar();
    expect(Number(inicial.item("tesis").style.opacity)).toBe(0);
    inicial.reloj.avanzar(8.5);
    expect(Number(inicial.item("tesis").style.opacity)).toBe(1);
    inicial.desmontar();
    restaurarEntorno();

    const pausas: Array<(escena: ReturnType<typeof montar>) => void> = [
      () => fijarOcultoDelDocumento(true),
      (escena) => escena.observador.visibilidad(0.1),
      (escena) => escena.pieza("per").dispatchEvent(new Event("pointerdown")),
    ];
    for (const pausar of pausas) {
      const escena = montar();
      escena.reloj.avanzar(8.5);
      expect(Number(escena.item("tesis").style.opacity)).toBe(1);
      pausar(escena);
      escena.reloj.avanzar(6);
      expect(Number(escena.item("tesis").style.opacity)).toBe(1);
      escena.desmontar();
      restaurarEntorno();
    }

    const ficha = montar();
    ficha.reloj.avanzar(6);
    const msft = ficha.llamadas.find((l) => l.metodo === "fillText" && l.args[0] === "MSFT");
    expect(msft).toBeDefined();
    ficha.pieza("escena").dispatchEvent(new MouseEvent("click", {
      bubbles: true, clientX: Number(msft!.args[1]), clientY: Number(msft!.args[2]),
    }));
    ficha.reloj.avanzar(6);
    expect(Number(ficha.item("tesis").style.opacity)).toBe(0);
    ficha.desmontar();
  });

  it("mantiene el reloj y el contador al aparcar con tiempo", () => {
    const escena = montar({ tiempo: 3 });
    escena.reloj.avanzar(0.1);
    const reloj = escena.pieza("relojTxt").textContent;
    const cuenta = escena.pieza("recuentoN").textContent;
    escena.reloj.avanzar(10);
    expect(escena.pieza("relojTxt").textContent).toBe(reloj);
    expect(escena.pieza("recuentoN").textContent).toBe(cuenta);
    escena.desmontar();
  });

  it("con movimiento reducido muestra el fotograma final", () => {
    const escena = montar({ reducido: true });
    escena.reloj.avanzar(0.1);
    expect(Number(escena.item("fin").style.opacity)).toBe(1);
    expect(escena.pieza("verFrase").textContent).not.toBe("");
    escena.desmontar();
  });

  it("abre y cierra la ficha de una empresa", () => {
    const escena = montar({ tiempo: 7 });
    escena.reloj.avanzar(0.1);
    const msft = escena.llamadas.find((l) => l.metodo === "fillText" && l.args[0] === "MSFT")!;
    const ficha = escena.pieza("ficha");
    escena.pieza("escena").dispatchEvent(new MouseEvent("click", {
      bubbles: true, clientX: Number(msft.args[1]), clientY: Number(msft.args[2]),
    }));
    expect(ficha.hasAttribute("hidden")).toBe(false);
    expect(ficha.textContent).toContain("MSFT");
    escena.pieza("escena").dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 1, clientY: 1 }));
    expect(ficha.hasAttribute("hidden")).toBe(true);
    escena.desmontar();
  });

  it("limpia fotogramas y listeners registrados", () => {
    const añadidos = vi.spyOn(window, "addEventListener");
    const quitados = vi.spyOn(window, "removeEventListener");
    const escena = montar();
    const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
    for (const tipo of ["scroll", "resize", "pointerup", "pointercancel"]) {
      listeners.set(tipo, new Set(añadidos.mock.calls.filter(([evento]) => evento === tipo).map(([, handler]) => handler)));
    }
    const antes = escena.llamadas.length;
    escena.limpiar();
    expect(escena.reloj.pendientes()).toBe(0);
    escena.reloj.avanzar(1);
    expect(escena.llamadas.length).toBe(antes);
    for (const [tipo, handlers] of listeners) {
      const removidos = quitados.mock.calls.filter(([evento]) => evento === tipo).map(([, handler]) => handler);
      for (const handler of handlers) expect(removidos).toContain(handler);
    }
    escena.desmontar();
  });

  it("formatea el contador en inglés", () => {
    const escena = montar({ idioma: "en", tiempo: 7 });
    escena.reloj.avanzar(0.1);
    expect(escena.pieza("recuentoN").textContent).toBe("2,987");
    escena.desmontar();
  });
});
