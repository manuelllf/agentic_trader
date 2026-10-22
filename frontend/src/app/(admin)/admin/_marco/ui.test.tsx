// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, it, vi } from "vitest";
import mensajes from "../../../../../messages/es/admin.json";
import { Pagina, Segmentos, Combo, Interruptor, Cifra, Barra, Estado } from "./ui";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let raiz: Root;
let caja: HTMLDivElement;
function pintar(children: ReactNode) {
  if (!caja) { caja = document.createElement("div"); document.body.append(caja); raiz = createRoot(caja); }
  act(() => raiz.render(<NextIntlClientProvider locale="es" messages={mensajes}>{children}</NextIntlClientProvider>));
  return caja;
}
afterEach(() => { act(() => raiz.unmount()); caja.remove(); caja = undefined!; });

it("Pagina marca el título repetido", () => {
  const vista = pintar(<Pagina titulo="Auditoría" repetido>Contenido</Pagina>);
  expect(vista.querySelector("h1")?.classList.contains("adm-h1-repetido")).toBe(true);
});
it("Pagina no marca el título por defecto", () => {
  const vista = pintar(<Pagina titulo="Resumen">Contenido</Pagina>);
  expect(vista.querySelector("h1")?.classList.contains("adm-h1-repetido")).toBe(false);
});

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

const opcionesCombo = [{ valor: "a", etiqueta: "A", cuenta: 0 }, { valor: "b", etiqueta: "B", cuenta: 3 }];
it("Combo abre con clic y expone la lista y la cuenta", () => {
  const vista = pintar(<Combo opciones={opcionesCombo} valor="a" alCambiar={vi.fn()} etiqueta="Filtro" />);
  const boton = vista.querySelector("button")!;
  expect(boton.getAttribute("aria-expanded")).toBe("false");
  expect(vista.querySelector('[role="listbox"]')).toBeNull();
  act(() => boton.click());
  expect(boton.getAttribute("aria-expanded")).toBe("true");
  const lista = vista.querySelector('[role="listbox"]')!;
  expect(boton.getAttribute("aria-controls")).toBe(lista.id);
  const opciones = lista.querySelectorAll('[role="option"]');
  expect(opciones[0].getAttribute("aria-selected")).toBe("true");
  expect(opciones[0].querySelector(".cuenta.num")?.textContent).toBe("0");
  expect(opciones[1].querySelector(".cuenta.num")?.textContent).toBe("3");
  expect(boton.getAttribute("aria-activedescendant")).toBe(opciones[0].id);
  act(() => boton.click());
  expect(boton.getAttribute("aria-expanded")).toBe("false");
});
it("Combo abre con Espacio y permanece abierto al soltarlo", () => {
  const vista = pintar(<Combo opciones={opcionesCombo} valor="a" alCambiar={vi.fn()} etiqueta="Filtro" />);
  const boton = vista.querySelector("button")!;
  expect(boton.getAttribute("role")).toBe("combobox");
  boton.focus();
  expect(document.activeElement).toBe(boton);
  expect(boton.getAttribute("aria-expanded")).toBe("false");
  act(() => boton.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true })));
  expect(boton.getAttribute("aria-expanded")).toBe("true");
  const soltar = new KeyboardEvent("keyup", { key: " ", bubbles: true, cancelable: true });
  act(() => boton.dispatchEvent(soltar));
  expect(soltar.defaultPrevented).toBe(true);
  expect(boton.getAttribute("aria-expanded")).toBe("true");
});
it("Combo abre con teclado y elige la siguiente manteniendo el foco", () => {
  const alCambiar = vi.fn();
  const vista = pintar(<Combo opciones={opcionesCombo} valor="a" alCambiar={alCambiar} etiqueta="Filtro" />);
  const boton = vista.querySelector("button")!;
  boton.focus();
  act(() => boton.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
  expect(boton.getAttribute("aria-expanded")).toBe("true");
  act(() => boton.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
  expect(alCambiar).not.toHaveBeenCalled();
  expect(boton.getAttribute("aria-activedescendant")).toBe(vista.querySelectorAll('[role="option"]')[1].id);
  act(() => boton.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  expect(alCambiar).toHaveBeenCalledWith("b");
  expect(vista.querySelector('[role="listbox"]')).toBeNull();
  expect(document.activeElement).toBe(boton);
});
it("Combo cierra con Escape sin elegir", () => {
  const alCambiar = vi.fn();
  const vista = pintar(<Combo opciones={opcionesCombo} valor="a" alCambiar={alCambiar} etiqueta="Filtro" />);
  const boton = vista.querySelector("button")!;
  act(() => boton.click());
  act(() => boton.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(vista.querySelector('[role="listbox"]')).toBeNull();
  expect(alCambiar).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(boton);
});
it("Combo cierra con pointerdown fuera sin elegir", () => {
  const alCambiar = vi.fn();
  const vista = pintar(<Combo opciones={opcionesCombo} valor="a" alCambiar={alCambiar} etiqueta="Filtro" />);
  const boton = vista.querySelector("button")!;
  act(() => boton.click());
  act(() => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
  expect(vista.querySelector('[role="listbox"]')).toBeNull();
  expect(alCambiar).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(boton);
});
