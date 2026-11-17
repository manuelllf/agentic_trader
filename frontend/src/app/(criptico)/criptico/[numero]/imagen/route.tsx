import { imagenDeAcertijo } from "../../../_criptico/ImagenCompartir";

// Imagen para compartir del acertijo en español. Ruta fija (no depende del hash de Next) para que la usen la metaetiqueta y los datos estructurados.
export async function GET(_request: Request, { params }: { params: Promise<{ numero: string }> }) {
  const { numero } = await params;
  return imagenDeAcertijo("es", numero);
}
