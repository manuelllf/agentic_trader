import Publicar from "../../_ui/Publicar";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Publicar key={id} id={Number(id)} />;
}
