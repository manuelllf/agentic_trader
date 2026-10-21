import { expect, it } from "vitest";
import { createTranslator } from "next-intl";
import mensajes from "../../../../../../messages/es/admin.json";
import { titular } from "./logica";
const t = createTranslator({ locale: "es", messages: mensajes });
it.each([[0, "Nada pendiente"], [1, "Una cosa para hoy"], [3, "3 cosas para hoy"]] as const)("titular con %i pendientes", (n, texto) => {
  expect(t(...titular(n))).toBe(texto);
});
