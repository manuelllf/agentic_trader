import { imagenDeAcertijo } from "../../../../_criptico/ImagenCompartir";

// Imagen para compartir del acertijo en inglés.
export async function GET(_request: Request, { params }: { params: Promise<{ numero: string }> }) {
  const { numero } = await params;
  return imagenDeAcertijo("en", numero);
}
