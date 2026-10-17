import AuthGate from "@/components/AuthGate";
import Editor from "../_ui/Editor";
import "../_ui/blog-admin.css";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AuthGate><Editor key={id} id={Number(id)} /></AuthGate>;
}
