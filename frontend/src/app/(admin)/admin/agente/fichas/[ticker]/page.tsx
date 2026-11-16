import FichaAgente from "../../FichaAgente";

export default async function Page({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  return <FichaAgente ticker={decodeURIComponent(ticker)} />;
}
