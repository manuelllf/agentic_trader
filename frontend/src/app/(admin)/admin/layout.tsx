import AuthGate from "@/components/AuthGate";
import { MarcoAdmin } from "./_marco/MarcoAdmin";

// Todas las pantallas de /admin dentro del mismo marco, solo con sesión de admin y 2FA.
export default function AdminMarcoLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AuthGate><MarcoAdmin>{children}</MarcoAdmin></AuthGate>;
}
