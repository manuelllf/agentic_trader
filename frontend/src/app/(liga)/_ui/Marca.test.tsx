import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Marca } from "./Marca";

describe("Marca", () => {
  it("muestra la palabra con una V sólida y dos t de vela", () => {
    const markup = renderToStaticMarkup(<Marca className="marca" />);
    expect(markup).toContain('viewBox="-2 38 999 210"');
    expect(markup).toContain('role="img"');
    expect(markup).toContain('aria-label="Vennett"');
    expect(markup).toContain('class="marca"');
    expect(markup).not.toContain("linearGradient");
    expect(markup).not.toContain("url(#");
    const paths = [...markup.matchAll(/<path\b[^>]*>/g)];
    expect(paths).toHaveLength(3);
    const firstD = paths[0][0].match(/\bd="([^"]+)"/)?.[1];
    expect(firstD).toMatch(/^M1\.2 48H57\.2L121\.25 159\.7/);
    expect(firstD).not.toContain("M877.3 241.5");
    expect(firstD).not.toContain("M977.3 241.5");
    expect(paths[2][0]).toContain('style="fill:var(--accent, #0B6E68)"');
  });
});
