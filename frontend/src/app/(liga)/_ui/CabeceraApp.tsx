import { Sesion } from "../_sesion/Sesion";
import { Marca } from "./Marca";

// Barra compartida por las pestañas; Liga mantiene su título grande debajo.
export function CabeceraApp({ titulo, anio }: { titulo?: string; anio?: number }) {
  if (anio !== undefined) {
    return <header className="cab"><span className="sello"><Marca className="marca" /><i aria-hidden="true" /><b className="num">{anio}</b></span><Sesion /></header>;
  }
  return <header className="cab centrada"><h1 className="cab-titulo">{titulo}</h1><Sesion /></header>;
}
