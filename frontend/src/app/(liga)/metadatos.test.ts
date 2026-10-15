import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Cada página de la liguilla tiene título propio: lo exporta la página o el layout de su carpeta.
const RAIZ = fileURLToPath(new URL(".", import.meta.url));

function paginas(carpeta: string): string[] {
  return readdirSync(carpeta, { withFileTypes: true }).flatMap((entrada) => {
    const ruta = join(carpeta, entrada.name);
    if (entrada.isDirectory()) return paginas(ruta);
    return entrada.name === "page.tsx" ? [ruta] : [];
  });
}

const exportaMetadata = (archivo: string) => /generateMetadata|export const metadata/.test(readFileSync(archivo, "utf8"));

// Las que solo redirigen no pintan nada: no necesitan título.
const pintan = paginas(RAIZ).filter((ruta) => !readFileSync(ruta, "utf8").includes("redirect("));

describe("metadatos por página de la liguilla", () => {
  it.each(pintan.map((ruta): [string, string] => [relative(RAIZ, ruta), ruta]))(
    "%s tiene título propio",
    (_relativa, ruta) => {
      const layout = join(dirname(ruta), "layout.tsx");
      expect(exportaMetadata(ruta) || (existsSync(layout) && exportaMetadata(layout))).toBe(true);
    },
  );
});
