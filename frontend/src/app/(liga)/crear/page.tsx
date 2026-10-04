import type { Metadata } from "next";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { EditorEstrategia } from "../_crear/EditorEstrategia";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: `${t("builder_metadata_create")} · Vennett` };
}

export default function Crear() {
  return <Suspense><EditorEstrategia /></Suspense>;
}
