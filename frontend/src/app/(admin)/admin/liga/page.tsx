import { redirect } from "next/navigation";

// El Resumen de antes ya es la portada de /admin: pendientes, lo próximo y el vistazo.
export default function ResumenAdmin() {
  redirect("/admin");
}
