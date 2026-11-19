import Decision from "../../Decision";

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ desde?: string }> }) {
  const [{ id }, { desde }] = await Promise.all([params, searchParams]);
  return <Decision id={id} desde={desde} />;
}
