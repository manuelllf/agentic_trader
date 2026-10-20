import { redirect } from "next/navigation";

// La portada del admin es el Resumen de Vennett; las salas están en el menú.
export default function Admin() {
  redirect("/admin/liga");
}
