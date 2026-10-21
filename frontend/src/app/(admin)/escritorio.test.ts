import { readFileSync, readdirSync } from "node:fs";
import { expect, it } from "vitest";
const raiz = new URL("./admin/liga/", import.meta.url);
const leer = (p: URL) => readFileSync(p, "utf8");
for (const ruta of ["resumen/Resumen.tsx", "analitica/page.tsx", "jornadas/page.tsx", "usuarios/PanelUsuarios.tsx", "consultas/page.tsx", "coste-ia/page.tsx", "revisar/page.tsx", "premio/page.tsx", "ajustes/page.tsx", "auditoria/page.tsx"]) {
  it(`${ruta} usa Pagina`, () => expect(leer(new URL(ruta, raiz))).toContain("<Pagina"));
}
function recorrer(dir: URL): URL[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const ruta = new URL(e.name + (e.isDirectory() ? "/" : ""), dir);
    return e.isDirectory() ? recorrer(ruta) : e.name.endsWith(".tsx") && !e.name.endsWith(".test.tsx") ? [ruta] : [];
  });
}
for (const ruta of recorrer(raiz)) {
  it(`${ruta.pathname} no contiene estilo antiguo ni JSON visible`, () => {
    const prohibido = /#c3c2b7|#898781|#303030|#3987e5|font-land-serif|admin_back_vennett|JSON\.stringify\(/;
    const fallos = leer(ruta).split("\n").flatMap((linea, i) => prohibido.test(linea) ? [`${ruta.pathname}:${i + 1}`] : []);
    expect(fallos).toEqual([]);
  });
}
