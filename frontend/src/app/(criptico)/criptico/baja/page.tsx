import { metadataCriptico, paginaToken } from "../../_criptico/paginas";

export const generateMetadata = () => metadataCriptico("es", undefined, "baja");

export default async function Page({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  return paginaToken("es", "baja", (await searchParams).token);
}
