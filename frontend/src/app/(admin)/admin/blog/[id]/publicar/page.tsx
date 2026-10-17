import AuthGate from "@/components/AuthGate";
import Publicar from "../../_ui/Publicar";
import "../../_ui/blog-admin.css";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AuthGate><Publicar key={id} id={Number(id)} /></AuthGate>;
}
