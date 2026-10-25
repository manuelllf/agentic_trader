import { NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// Baja en un clic (RFC 8058): el gestor de correo hace POST a la cabecera List-Unsubscribe
// sin abrir ninguna página, así que la baja se resuelve aquí contra la API.
export async function POST(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) return NextResponse.json({ ok: false }, { status: 400 });
  const respuesta = await fetch(`${API_URL}/criptico/suscripcion/baja?token=${encodeURIComponent(token)}`,
    { cache: "no-store" });
  if (!respuesta.ok) return NextResponse.json({ ok: false }, { status: 502 });
  return NextResponse.json(await respuesta.json());
}
