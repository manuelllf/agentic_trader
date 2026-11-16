import Decision from "../../Decision";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Decision id={id} />;
}
