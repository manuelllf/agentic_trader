import AgenteRaiz from "./AgenteRaiz";
import { vistaDe } from "./vistas";

export default async function Page({ searchParams }: { searchParams: Promise<{ v?: string }> }) {
  const { v } = await searchParams;
  return <AgenteRaiz inicial={vistaDe(v)} />;
}
