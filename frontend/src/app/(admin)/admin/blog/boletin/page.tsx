import AuthGate from "@/components/AuthGate";
import Boletin from "../_ui/Boletin";
import "../_ui/blog-admin.css";
export default function Page() {
  return <AuthGate><Boletin /></AuthGate>;
}
