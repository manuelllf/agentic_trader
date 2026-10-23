import { metadataCriptico, paginaToken } from "../../../_criptico/paginas";

export const generateMetadata = () => metadataCriptico("en", undefined, "confirmar");

export default async function Page({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  return paginaToken("en", "confirmar", (await searchParams).token);
}
