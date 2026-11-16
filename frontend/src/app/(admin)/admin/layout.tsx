import AuthGate from "@/components/AuthGate";
import { Marco } from "./_panel/Marco";

// Todas las pantallas de /admin dentro del mismo marco, solo con sesión de admin y 2FA.
export default function AdminMarcoLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AuthGate><Marco>{children}</Marco></AuthGate>;
}
