import { metadataCriptico, pagina } from "../../../_criptico/paginas";

export async function generateMetadata({ params }: { params: Promise<{ numero: string }> }) {
  return metadataCriptico("en", (await params).numero);
}

export default async function Page({ params }: { params: Promise<{ numero: string }> }) {
  return pagina("en", (await params).numero);
}
