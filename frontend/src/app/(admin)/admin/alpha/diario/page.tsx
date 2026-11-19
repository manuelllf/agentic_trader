import { redirect } from "next/navigation";

// El diario pasó a ser «Todas las decisiones», con el mismo buscador.
export default function Page() {
  redirect("/admin/alpha/decisiones?buscar=1");
}
