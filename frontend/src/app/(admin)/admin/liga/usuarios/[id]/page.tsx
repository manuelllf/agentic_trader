"use client";
import { Suspense } from "react";
import { useParams } from "next/navigation";
import AuthGate from "@/components/AuthGate";
import { FichaUsuario } from "../FichaUsuario";
export default function UsuarioDetalleAdmin() {
  const { id } = useParams<{ id: string }>();
  return (
    <AuthGate>
      <Suspense fallback={null}>
        <FichaUsuario id={id} />
      </Suspense>
    </AuthGate>
  );
}
