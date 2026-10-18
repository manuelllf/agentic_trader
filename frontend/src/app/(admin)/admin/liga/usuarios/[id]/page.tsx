"use client";
import { Suspense } from "react";
import { useParams } from "next/navigation";
import AuthGate from "@/components/AuthGate";
import { PanelUsuarios } from "../PanelUsuarios";
export default function UsuarioDetalleAdmin() {
  const { id } = useParams<{ id: string }>();
  return (
    <AuthGate>
      <Suspense fallback={null}>
        <PanelUsuarios seleccionado={id} />
      </Suspense>
    </AuthGate>
  );
}
