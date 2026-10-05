"use client";

import { useTranslations } from "next-intl";
import { miVentana, verEstrategia, type Estrategia, type Ventana } from "@/lib/liga/api";
import { useCache } from "@/lib/liga/cache";
import { Sesion } from "../_sesion/Sesion";
import { useSesionRequerida } from "../_sesion/SesionContext";
import { BarraPestanas, Cargando, VentanaCambios } from "../_ui";
import { EditorEstrategia } from "./EditorEstrategia";

/** Del corte hasta que abre la jornada la estrategia ya tiene su cartera formada y solo admite
 *  cambiar y recuperar empresas: en vez del editor se enseña esa cartera. El resto del tiempo, el
 *  editor de siempre. */
export function EditorOVentana({ estrategiaId }: { estrategiaId: string }) {
  const t = useTranslations();
  const { estado } = useSesionRequerida(`/crear/${estrategiaId}`);
  const { datos, refrescar } = useCache<Ventana[] | string>(
    estado === "dentro" ? "ventana" : null, miVentana,
  );
  const ventana = Array.isArray(datos) ? datos.find((v) => v.estrategia_id === estrategiaId) : undefined;
  const { datos: estrategia } = useCache<Estrategia | string>(
    ventana ? `estrategia:${estrategiaId}` : null, () => verEstrategia(estrategiaId),
  );

  if (estado === "cargando" || (estado === "dentro" && datos === undefined)) {
    return <main className="scroll"><div style={{ marginTop: 20 }}><Cargando filas={3} /></div></main>;
  }
  if (!ventana) return <EditorEstrategia estrategiaIdInicial={estrategiaId} />;

  const nombre = typeof estrategia === "object" && estrategia ? estrategia.nombre : "";
  return (
    <main className="scroll">
      <div className="titulo-cuenta"><h1 className="h1">{nombre || t("builder_metadata_edit")}</h1><Sesion /></div>
      <VentanaCambios ventana={ventana} nombre={nombre} alCerrarse={refrescar} />
      <BarraPestanas />
    </main>
  );
}
