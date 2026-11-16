import Editor from "../_ui/Editor";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Editor key={id} id={Number(id)} />;
}
