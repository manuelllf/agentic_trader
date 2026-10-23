import { metadataCriptico, paginaToken } from "../../_criptico/paginas";

export const generateMetadata = () => metadataCriptico("es", undefined, "confirmar");

export default async function Page({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  return paginaToken("es", "confirmar", (await searchParams).token);
}
