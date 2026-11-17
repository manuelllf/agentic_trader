import { redirect } from "next/navigation";

// El diario pasó a ser «Todas las decisiones», con el mismo buscador.
export default function Page() {
  redirect("/admin/agente/decisiones?buscar=1");
}
