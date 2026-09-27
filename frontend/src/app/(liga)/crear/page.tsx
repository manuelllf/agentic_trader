import type { Metadata } from "next";
import { EditorEstrategia } from "../_crear/EditorEstrategia";

export const metadata: Metadata = { title: "Crear · liguilla" };

export default function Crear() {
  return <EditorEstrategia />;
}
