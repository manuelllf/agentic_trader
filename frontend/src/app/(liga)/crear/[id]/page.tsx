import type { Metadata } from "next";
import { Suspense } from "react";
import { EditorEstrategia } from "../../_crear/EditorEstrategia";

export const metadata: Metadata = { title: "Editar estrategia · Vennett" };

export default async function EditarEstrategia({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <Suspense><EditorEstrategia estrategiaIdInicial={id} /></Suspense>;
}
