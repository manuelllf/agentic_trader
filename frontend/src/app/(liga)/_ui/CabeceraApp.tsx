import { Campana } from "../_avisos/Campana";
import { Sesion } from "../_sesion/Sesion";
import { Marca } from "./Marca";

// Barra compartida por las pestañas; Liga mantiene su título grande debajo.
// El menú va primero para que su sitio sea el mismo en todas las pantallas.
export function CabeceraApp({ titulo, anio }: { titulo?: string; anio?: number }) {
  if (anio !== undefined) {
    return <header className="cab cab-sello"><Sesion /><span className="sello"><Marca className="marca" /><i aria-hidden="true" /><b className="num">{anio}</b></span><Campana variante="cabecera" /></header>;
  }
  return <header className="cab centrada"><Sesion /><h1 className="cab-titulo">{titulo}</h1><Campana variante="cabecera" /></header>;
}
