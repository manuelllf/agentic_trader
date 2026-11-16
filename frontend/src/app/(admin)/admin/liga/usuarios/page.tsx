"use client";
import { Suspense } from "react";
import AuthGate from "@/components/AuthGate";
import { ListaUsuarios } from "./ListaUsuarios";
export default function UsuariosAdmin() {
  return (
    <AuthGate>
      <Suspense fallback={null}>
        <ListaUsuarios />
      </Suspense>
    </AuthGate>
  );
}
