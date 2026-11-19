import FichaAgente from "../../FichaAgente";

export default async function Page({ params, searchParams }: { params: Promise<{ ticker: string }>; searchParams: Promise<{ desde?: string }> }) {
  const [{ ticker }, { desde }] = await Promise.all([params, searchParams]);
  return <FichaAgente ticker={decodeURIComponent(ticker)} desde={desde} />;
}
