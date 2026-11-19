import Informe from "../../Informe";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Informe id={id} />;
}
