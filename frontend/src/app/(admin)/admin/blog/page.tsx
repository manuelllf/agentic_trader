import AuthGate from "@/components/AuthGate";
import Lista from "./_ui/Lista";
import "./_ui/blog-admin.css";
export default function Page() { return <AuthGate><Lista /></AuthGate>; }
