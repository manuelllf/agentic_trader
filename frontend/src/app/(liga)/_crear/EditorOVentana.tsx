"use client";

import { useTranslations } from "next-intl";
import { miVentana, verEstrategia, type Estrategia, type Ventana } from "@/lib/liga/api";
import { useCache } from "@/lib/liga/cache";
import { useSesionRequerida } from "../_sesion/SesionContext";
import { BarraPestanas, CabeceraApp, Cargando, ProximaCartera, VentanaCambios } from "../_ui";
import { EditorEstrategia } from "./EditorEstrategia";

/** Del corte a la apertura de la semana se enseña la cartera formada; el resto de la semana,
 * el editor de siempre con la cartera de la semana que viene cuando ya salió. */
export function EditorOVentana({ estrategiaId }: { estrategiaId: string }) {
  const t = useTranslations();
  const { estado } = useSesionRequerida(`/crear/${estrategiaId}`);
  const { datos, refrescar } = useCache<Ventana[] | string>(
    estado === "dentro" ? "ventana" : null, miVentana,
  );
  const ventana = Array.isArray(datos) ? datos.find((v) => v.estrategia_id === estrategiaId) : undefined;
  const { datos: estrategia } = useCache<Estrategia | string>(
    ventana && ventana.fase !== "siguiente" ? `estrategia:${estrategiaId}` : null, () => verEstrategia(estrategiaId),
  );

  if (estado === "cargando" || (estado === "dentro" && datos === undefined)) {
    return <main className="scroll"><div style={{ marginTop: 20 }}><Cargando filas={3} /></div></main>;
  }
  if (!ventana || ventana.fase === "siguiente") return (
    <EditorEstrategia estrategiaIdInicial={estrategiaId}
      antes={ventana?.proxima?.length ? <ProximaCartera ventana={ventana} /> : undefined} />
  );

  const nombre = typeof estrategia === "object" && estrategia ? estrategia.nombre : "";
  return (
    <main className="scroll">
      <CabeceraApp titulo={nombre || t("builder_metadata_edit")} />
      <VentanaCambios ventana={ventana} nombre={nombre} alCerrarse={refrescar} />
      <BarraPestanas />
    </main>
  );
}
