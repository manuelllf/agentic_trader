"use client";

// Caché mínima de módulo (patrón stale-while-revalidate), pensada para las pantallas de `(liga)`:
// al volver a una pestaña ya vista se pinta al instante con el último dato bueno mientras se
// revalida en segundo plano, en vez de mostrar un esqueleto otra vez. Sin dependencia nueva:
// un `Map` compartido entre componentes + un hook mínimo con `useSyncExternalStore`.
//
// No es un caché HTTP: vive en memoria de la pestaña del navegador, se vacía al recargar y es
// intencionadamente tonto (sin TTL, sin reintentos) — con datos que cambian por acción del propio
// usuario (apuntarse, comprar créditos...) la invalidación explícita (`invalidar`/`mutar`) basta.

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

type Entrada<T> = { datos: T };

const cache = new Map<string, Entrada<unknown>>();
const enVuelo = new Map<string, Promise<unknown>>();
const suscriptores = new Map<string, Set<() => void>>();
// Claves cuya última petición falló y no tienen dato: es un fallo, no un dato, así que no se
// guarda como si lo fuera; la siguiente lectura o «reintentar» vuelve a pedir.
const fallidas = new Set<string>();

/** ¿La última petición de `clave` falló (y no hay dato guardado)? */
export function haFallado(clave: string): boolean {
  return fallidas.has(clave);
}

function notificar(clave: string): void {
  suscriptores.get(clave)?.forEach((fn) => fn());
}

function suscribir(clave: string, fn: () => void): () => void {
  let set = suscriptores.get(clave);
  if (!set) {
    set = new Set();
    suscriptores.set(clave, set);
  }
  set.add(fn);
  return () => {
    set!.delete(fn);
    if (set!.size === 0) suscriptores.delete(clave);
  };
}

function pedir<T>(clave: string, fetcher: () => Promise<T>): Promise<T> {
  const existente = enVuelo.get(clave) as Promise<T> | undefined;
  if (existente) return existente;
  const p = fetcher()
    .then((datos) => {
      cache.set(clave, { datos });
      fallidas.delete(clave);
      enVuelo.delete(clave);
      notificar(clave);
      return datos;
    })
    .catch((err) => {
      enVuelo.delete(clave);
      fallidas.add(clave);
      notificar(clave);
      throw err;
    });
  enVuelo.set(clave, p);
  return p;
}

/** Deja el dato de `clave` puesto a mano (p. ej. tras una acción, con lo que ya devolvió la API),
 *  sin ir a la red. Avisa a quien esté leyendo esa clave ahora mismo. */
export function fijar<T>(clave: string, datos: T): void {
  cache.set(clave, { datos });
  notificar(clave);
}

/** Igual que `fijar`, pero a partir del valor anterior (o `undefined` si no hay caché todavía).
 *  Devuelve el valor anterior, para poder deshacer el cambio si la llamada real falla. */
export function mutar<T>(clave: string, actualizador: (anterior: T | undefined) => T): T | undefined {
  const anterior = (cache.get(clave) as Entrada<T> | undefined)?.datos;
  cache.set(clave, { datos: actualizador(anterior) });
  notificar(clave);
  return anterior;
}

/** Borra una o varias claves (fuerza a pedirlas de nuevo la próxima vez que se lean). Úsalo tras
 *  una acción que cambie datos que otras pantallas puedan tener cacheados (p. ej. créditos tras
 *  gastar alguno, o `yo` tras cambiar de alias). */
export function invalidar(...claves: string[]): void {
  for (const c of claves) {
    cache.delete(c);
    fallidas.delete(c);
    notificar(c);
  }
}

/** Empieza a pedir `clave` si todavía no está en caché ni en vuelo, sin esperar el resultado ni
 *  suscribir nada: para precargar datos de la pestaña siguiente en cuanto pinta la actual. */
export function precargar<T>(clave: string | null, fetcher: () => Promise<T>): void {
  if (!clave || cache.has(clave) || enVuelo.has(clave)) return;
  pedir(clave, fetcher).catch(() => {});
}

/** Como `pedir`, pero para una lectura suelta fuera de un componente (p. ej. dentro de un
 *  `useEffect` que ya hace más cosas después): si `clave` ya está en caché, se devuelve al
 *  instante sin ir a la red; si no, se pide una vez y se guarda para quien venga después. */
export async function obtener<T>(clave: string, fetcher: () => Promise<T>): Promise<T> {
  const existente = cache.get(clave) as Entrada<T> | undefined;
  if (existente) return existente.datos;
  return pedir(clave, fetcher);
}

/** Lee `clave` con caché de módulo: si ya hay dato, se devuelve al instante (sin `cargando`) y de
 *  todos modos se revalida en segundo plano; si no hay nada, `datos` es `undefined` hasta que
 *  llegue la primera respuesta. `clave === null` desactiva la lectura (p. ej. mientras no se sabe
 *  si hay sesión todavía) sin tocar lo que ya hubiera en caché. */
export function useCache<T>(
  clave: string | null,
  fetcher: () => Promise<T>,
): { datos: T | undefined; cargando: boolean; fallo: boolean; refrescar: () => void } {
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const suscribirClave = useCallback(
    (fn: () => void) => (clave ? suscribir(clave, fn) : () => {}),
    [clave],
  );
  const leer = useCallback(
    () => (clave ? (cache.get(clave) as Entrada<T> | undefined)?.datos : undefined),
    [clave],
  );
  const datos = useSyncExternalStore(suscribirClave, leer, leer);
  const leerFallo = useCallback(() => (clave ? fallidas.has(clave) : false), [clave]);
  const fallo = useSyncExternalStore(suscribirClave, leerFallo, leerFallo) && datos === undefined;

  useEffect(() => {
    // Revalida siempre que cambie la clave (incluye la primera vez): stale-while-revalidate.
    if (clave) pedir(clave, fetcherRef.current).catch(() => {});
  }, [clave]);

  const refrescar = useCallback(() => {
    if (clave) pedir(clave, fetcherRef.current).catch(() => {});
  }, [clave]);

  return { datos, cargando: !!clave && datos === undefined && !fallo, fallo, refrescar };
}
