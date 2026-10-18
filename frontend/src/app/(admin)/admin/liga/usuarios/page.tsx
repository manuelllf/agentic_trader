"use client";
import { Suspense } from "react";
import AuthGate from "@/components/AuthGate";
import { PanelUsuarios } from "./PanelUsuarios";
export default function UsuariosAdmin() {
  return (
    <AuthGate>
      <Suspense fallback={null}>
        <PanelUsuarios />
      </Suspense>
    </AuthGate>
  );
}
