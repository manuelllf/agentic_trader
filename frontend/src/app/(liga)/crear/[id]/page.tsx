import type { Metadata } from "next";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { EditorEstrategia } from "../../_crear/EditorEstrategia";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: `${t("builder_metadata_edit")} · Vennett` };
}

export default async function EditarEstrategia({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <Suspense><EditorEstrategia estrategiaIdInicial={id} /></Suspense>;
}
