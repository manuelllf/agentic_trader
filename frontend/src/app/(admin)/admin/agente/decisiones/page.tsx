import Decisiones from "../Decisiones";

export default async function Page({ searchParams }: { searchParams: Promise<{ buscar?: string }> }) {
  const { buscar } = await searchParams;
  return <Decisiones buscar={buscar === "1"} />;
}
