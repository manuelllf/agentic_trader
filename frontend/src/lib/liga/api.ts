// Cliente de la API de la liga (`/liga/*`). Manda el token de Supabase; las salas usan lib/api.ts.
import { tokenSesion } from "./supabase";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type Yo = {
  alias: string;
  plan: "gratis" | "pro";
  roles: string[];
  admin: boolean;
  aal2: boolean;
};

/** Quién eres según el backend; null sin sesión o si no responde. */
export async function getYo(): Promise<Yo | null> {
  const sesion = await tokenSesion();
  if (!sesion) return null;
  try {
    const res = await fetch(`${API_URL}/liga/yo`, {
      headers: { Authorization: `Bearer ${sesion.token}` },
      cache: "no-store",
    });
    return res.ok ? ((await res.json()) as Yo) : null;
  } catch {
    return null;
  }
}
