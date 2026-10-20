import AuthGate from "@/components/AuthGate";
import Resumen from "./resumen/Resumen";

export default function ResumenAdmin() {
  return <AuthGate><Resumen /></AuthGate>;
}
