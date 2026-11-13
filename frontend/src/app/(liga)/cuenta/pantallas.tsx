"use client";

// Qué componente pinta cada pantalla de Cuenta; lo usan la hoja del móvil y las páginas de escritorio.

import type { ComponentType } from "react";
import type { Pantalla } from "./marco";
import { PanelCuenta } from "./PanelCuenta";
import { NombreCuenta } from "./NombreCuenta";
import { ClaveCuenta } from "./ClaveCuenta";
import { VerificacionCuenta } from "./VerificacionCuenta";
import { AvisosCuenta } from "./AvisosCuenta";
import { LegalCuenta } from "./LegalCuenta";
import { BorrarCuenta } from "./BorrarCuenta";
import { PlanPantalla } from "./PlanPantalla";

export const PANTALLAS: Record<Pantalla, ComponentType> = {
  inicio: PanelCuenta, nombre: NombreCuenta, clave: ClaveCuenta, verificacion: VerificacionCuenta,
  avisos: AvisosCuenta, legal: LegalCuenta, borrar: BorrarCuenta, plan: PlanPantalla,
};
