import { Campana } from "../_avisos/Campana";
import { Sesion } from "../_sesion/Sesion";
import { Marca } from "./Marca";

// Barra compartida por las pestañas; Liga mantiene su título grande debajo.
// El menú va primero para que su sitio sea el mismo en todas las pantallas.
// `tituloBarra` es el título que sustituye al sello al subir (maqueta v12): lo pone la pantalla con
// título grande, y la cabecera lo muestra cuando ese título sale de la vista.
export function CabeceraApp({ titulo, anio, tituloBarra }: { titulo?: string; anio?: number; tituloBarra?: string }) {
  if (anio !== undefined) {
    return <header className="cab cab-sello"><Sesion /><span className="sello"><Marca className="marca" /><i aria-hidden="true" /><b className="num">{anio}</b></span>
      {tituloBarra && <span className="titulo-barra" aria-hidden="true">{tituloBarra}</span>}<Campana variante="cabecera" /></header>;
  }
  return <header className="cab centrada"><Sesion /><h1 className="cab-titulo">{titulo}</h1><Campana variante="cabecera" /></header>;
}
