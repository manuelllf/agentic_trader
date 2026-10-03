import type { Metadata } from "next";
import { Suspense } from "react";
import { EditorEstrategia } from "../_crear/EditorEstrategia";

export const metadata: Metadata = { title: "Crear · Vennett" };

export default function Crear() {
  return <Suspense><EditorEstrategia /></Suspense>;
}
