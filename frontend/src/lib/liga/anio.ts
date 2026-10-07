import type { Portada } from "@/lib/liga/api";

export function anioDeLiga(portada: Pick<Portada, "en_juego" | "proxima"> | null | undefined, ahora: Date = new Date()): number {
  // Los nombres de temporada no incluyen el año.
  for (const jornada of [portada?.en_juego, portada?.proxima]) {
    if (!jornada) continue;
    const anio = Number(jornada.dia_inicio.slice(0, 4));
    if (Number.isFinite(anio)) return anio;
  }
  return ahora.getFullYear();
}
