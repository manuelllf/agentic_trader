import EnVivo from "../EnVivo";

export default async function Page({ searchParams }: { searchParams: Promise<{ decision?: string }> }) {
  const { decision } = await searchParams;
  return <EnVivo decisionId={decision && /^\d+$/.test(decision) ? decision : undefined} />;
}
