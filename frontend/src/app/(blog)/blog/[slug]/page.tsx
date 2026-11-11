import { Leccion, metadataBlog } from "../../_blog/paginas";

type Props = { params: Promise<{ slug: string }> };
export const revalidate = 300;
export async function generateMetadata({ params }: Props) { return metadataBlog("es", (await params).slug); }
export default async function Page({ params }: Props) {
  return <Leccion idioma="es" slug={(await params).slug} />;
}
