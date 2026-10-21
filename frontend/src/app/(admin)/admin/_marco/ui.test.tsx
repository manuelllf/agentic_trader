// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, it, vi } from "vitest";
import mensajes from "../../../../../messages/es/admin.json";
import { Segmentos, Interruptor, Cifra, Barra, Estado } from "./ui";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let raiz: Root;
let caja: HTMLDivElement;
function pintar(children: ReactNode) {
  if (!caja) { caja = document.createElement("div"); document.body.append(caja); raiz = createRoot(caja); }
  act(() => raiz.render(<NextIntlClientProvider locale="es" messages={mensajes}>{children}</NextIntlClientProvider>));
  return caja;
}
afterEach(() => { act(() => raiz.unmount()); caja.remove(); caja = undefined!; });

it("Segmentos comunica el cambio y marca el valor seleccionado", () => {
  const alCambiar = vi.fn();
  const opciones = [{ valor: "a", etiqueta: "A", cuenta: 0 }, { valor: "b", etiqueta: "B", cuenta: 3 }];
  const vista = pintar(<Segmentos opciones={opciones} valor="a" alCambiar={alCambiar} etiqueta="Filtro" />);
  expect(vista.querySelector('[role="tablist"]')?.getAttribute("aria-label")).toBe("Filtro");
  const tabs = vista.querySelectorAll<HTMLButtonElement>('[role="tab"]');
  expect(tabs[0].getAttribute("aria-selected")).toBe("true");
  expect(tabs[1].getAttribute("aria-selected")).toBe("false");
  act(() => tabs[1].click());
  expect(alCambiar).toHaveBeenCalledWith("b");
  pintar(<Segmentos opciones={opciones} valor="b" alCambiar={alCambiar} etiqueta="Filtro" />);
  expect(tabs[1].getAttribute("aria-selected")).toBe("true");
});
it("Interruptor comunica el nuevo estado y respeta disabled", () => {
  const alCambiar = vi.fn();
  const vista = pintar(<Interruptor encendido alCambiar={alCambiar} etiqueta="Activo" />);
  const boton = vista.querySelector<HTMLButtonElement>('[role="switch"]')!;
  expect(boton.getAttribute("aria-checked")).toBe("true");
  act(() => boton.click());
  expect(alCambiar).toHaveBeenCalledWith(false);
  pintar(<Interruptor encendido={false} alCambiar={alCambiar} etiqueta="Activo" deshabilitado />);
  expect(boton.getAttribute("aria-checked")).toBe("false");
  act(() => boton.click());
  expect(alCambiar).toHaveBeenCalledTimes(1);
});
it("Cifra con href enlaza toda la cifra", () => {
  const vista = pintar(<Cifra etiqueta="Usuarios" valor="42" nota="Total" href="/admin/liga/usuarios" />);
  const enlace = vista.querySelector("a")!;
  expect(enlace.getAttribute("href")).toBe("/admin/liga/usuarios");
  expect(enlace.textContent).toBe("Usuarios42Total");
});
it.each([[150, 100, "100%"], [-1, 100, "0%"], [50, 100, "50%"], [1, 0, "0%"]])("Barra acota %s / %s", (valor, maximo, ancho) => {
  const vista = pintar(<Barra valor={valor} maximo={maximo} />);
  expect(vista.querySelector<HTMLElement>(".adm-barra span")?.style.width).toBe(ancho);
});
it.each([ ["cargando", "status", "Cargando…"], ["error", "alert", "No se ha podido cargar. Vuelve a intentarlo."], ["vacio", "status", "Nada por aquí."] ] as const)("Estado %s tiene el rol y texto adecuados", (tipo, role, texto) => {
  const vista = pintar(<Estado tipo={tipo} />);
  expect(vista.querySelector(`[role="${role}"]`)?.textContent).toBe(texto);
  pintar(<Estado tipo={tipo}>Personalizado</Estado>);
  expect(vista.querySelector("p")?.textContent).toBe("Personalizado");
});
