import AuthGate from "@/components/AuthGate";
import Editor from "../_ui/Editor";
import "../_ui/blog-admin.css";
export default function Page() { return <AuthGate><Editor /></AuthGate>; }
