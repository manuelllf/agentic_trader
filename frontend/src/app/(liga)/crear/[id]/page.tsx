import type { Metadata } from "next";
import { EditorEstrategia } from "../../_crear/EditorEstrategia";

export const metadata: Metadata = { title: "Editar estrategia · liguilla" };

export default async function EditarEstrategia({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <EditorEstrategia estrategiaIdInicial={id} />;
}
