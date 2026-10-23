import { metadataCriptico, paginaToken } from "../../../_criptico/paginas";

export const generateMetadata = () => metadataCriptico("en", undefined, "baja");

export default async function Page({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  return paginaToken("en", "baja", (await searchParams).token);
}
