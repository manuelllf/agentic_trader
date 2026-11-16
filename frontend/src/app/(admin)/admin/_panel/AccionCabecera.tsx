"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

// Hueco de la cabecera del marco: cada pantalla puede poner una acción (como el «+» de Omega) y la retira al salir.
interface Valor { accion: ReactNode; fijar: (n: ReactNode) => void }

const Contexto = createContext<Valor>({ accion: null, fijar: () => {} });

export function ProveedorAccionCabecera({ children }: { children: ReactNode }) {
  const [accion, fijar] = useState<ReactNode>(null);
  const valor = useMemo(() => ({ accion, fijar }), [accion]);
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

/** La acción que la pantalla actual ha puesto en la cabecera, o nada. */
export function useAccionCabecera(): ReactNode {
  return useContext(Contexto).accion;
}

/** Función para poner o quitar la acción de la cabecera desde una pantalla. */
export function useFijarAccionCabecera(): (n: ReactNode) => void {
  return useContext(Contexto).fijar;
}
