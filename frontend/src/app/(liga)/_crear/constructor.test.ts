import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// `marca` también es la palabra Vennett de la cabecera: una regla sin acotar la pinta en gris.
describe("constructor.css", () => {
  it("no pinta .marca fuera del constructor", () => {
    const css = readFileSync(new URL("./constructor.css", import.meta.url), "utf8");
    expect(css).not.toMatch(/^\.lg \.marca/m);
  });
});
