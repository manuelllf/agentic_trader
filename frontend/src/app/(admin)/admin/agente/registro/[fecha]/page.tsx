import Registro from "../../Registro";

export default async function Page({ params }: { params: Promise<{ fecha: string }> }) {
  const { fecha } = await params;
  return <Registro fecha={fecha} />;
}
