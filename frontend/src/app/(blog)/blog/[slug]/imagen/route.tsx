import { imagenDeArticulo } from "../../../_blog/ImagenArticulo";

// Imagen para compartir del artículo en español.
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return imagenDeArticulo("es", slug);
}
