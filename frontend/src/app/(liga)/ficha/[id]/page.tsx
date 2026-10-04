"use client";

import { useParams } from "next/navigation";
import { FichaContenido } from "./FichaContenido";

export default function FichaPage() {
  const { id } = useParams<{ id: string }>();
  return <FichaContenido key={id} id={id} />;
}
