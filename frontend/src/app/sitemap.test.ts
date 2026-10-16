import { expect, it } from "vitest";
import sitemap from "./sitemap";

it("publica exactamente las seis URLs públicas", () => {
  expect(sitemap()).toEqual([
    { url: "https://vennett.app/" },
    { url: "https://vennett.app/como-funciona" },
    { url: "https://vennett.app/legal/aviso" },
    { url: "https://vennett.app/legal/privacidad" },
    { url: "https://vennett.app/legal/terminos" },
    { url: "https://vennett.app/legal/cookies" },
  ]);
});
