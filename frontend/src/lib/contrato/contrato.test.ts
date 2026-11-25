// Cada lado pasaba sus pruebas y la portada salió sin demo: pedía una dirección que el backend no tenía.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { existe, leerLlamadas } from "./llamadas";
import rutas from "./rutas.json";

const SRC = resolve(__dirname, "../..");
const ficheros = (readdirSync(SRC, { recursive: true }) as string[])
  .filter((f) => /\.tsx?$/.test(f) && !/\.(test|fixture|d)\./.test(f))
  .map((f) => relative(SRC, join(SRC, f)).replace(/\\/g, "/"))
  .filter((f) => !f.startsWith("lib/contrato/"));
const lecturas = ficheros.map((f) => ({ f, codigo: readFileSync(join(SRC, f), "utf8") }))
  .map(({ f, codigo }) => ({ f, codigo, ...leerLlamadas(f, codigo) }));
const llamadas = lecturas.flatMap((l) => l.llamadas);

// Las funciones que solo pasan la ruta que reciben: se comprueba donde se llaman.
const PASAN_LA_RUTA = [
  "lib/api.ts `${API_URL}${path}`",
  "lib/api.ts request(path)",
  "lib/aprender.ts `${API_URL}${ruta}`",
  "lib/criptico/api.ts `${API_URL}${path}`",
  "lib/liga/api.ts `${API_URL}${ruta}`",
  "app/(admin)/admin/alpha/useCarga.ts getAgente(ruta)",
  "app/(admin)/admin/liga/revisar/Revisar.tsx get(ruta)",
];
// Nombran la variable de la API sin pedir nada con una ruta propia.
const SIN_LLAMADAS = ["middleware.ts"];

describe("el frontend solo pide direcciones que el backend sirve", () => {
  it("encuentra las llamadas", () => {
    expect(llamadas.filter((l) => l.servicio === "vennett").length).toBeGreaterThan(150);
    expect(llamadas.filter((l) => l.servicio === "agente").length).toBeGreaterThan(15);
  });

  it("todas existen, con su método", () => {
    const rotas = llamadas.filter((l) => !existe(l, rutas[l.servicio]))
      .map((l) => `${l.donde} ${l.metodo ?? "?"} ${l.ruta} (${l.servicio})`);
    expect(rotas).toEqual([]);
  });

  it("no queda ninguna sin poder leer", () => {
    expect(lecturas.flatMap((l) => l.sinResolver).filter((s) => !PASAN_LA_RUTA.includes(s))).toEqual([]);
  });

  it("todo fichero que usa la dirección de la API aporta alguna llamada comprobada", () => {
    const mudos = lecturas.filter((l) => l.codigo.includes("NEXT_PUBLIC_API_URL") && l.llamadas.length === 0)
      .map((l) => l.f);
    expect(mudos.filter((f) => !SIN_LLAMADAS.includes(f))).toEqual([]);
  });
});

describe("el lector de llamadas", () => {
  const una = (codigo: string, fichero = "x.ts") => leerLlamadas(fichero, codigo).llamadas;
  const servidas = ["GET /liga/aprender/portada", "DELETE /liga/estrategias/{id}", "POST /blog/admin/articulos/{id}/publicar"];

  it("habría parado la portada sin demo", () => {
    const [mala] = una("fetch(`${API_URL}/aprender/portada?idioma=${idioma}`)");
    const [buena] = una("fetch(`${API_URL}/liga/aprender/portada?idioma=${idioma}`)");
    expect(existe(mala, servidas)).toBe(false);
    expect(existe(buena, servidas)).toBe(true);
  });

  it("distingue el método y trata las partes variables", () => {
    const [borrar] = una('llamar(`/liga/estrategias/${id}`, { method: "DELETE" })');
    expect(borrar).toMatchObject({ metodo: "DELETE", ruta: "/liga/estrategias/*" });
    expect(existe(borrar, servidas)).toBe(true);
    expect(existe({ ...borrar, metodo: "PATCH" }, servidas)).toBe(false);
  });

  it("pone el prefijo de cada función", () => {
    const [publicar] = una('llamar(`/articulos/${id}/publicar`, "POST", cuerpo)', "lib/blog/admin.ts");
    expect(existe(publicar, servidas)).toBe(true);
  });

  it("avisa de una ruta que no puede leer", () => {
    expect(leerLlamadas("x.ts", "get(direccion)").sinResolver).toEqual(["x.ts get(direccion)"]);
  });
});
