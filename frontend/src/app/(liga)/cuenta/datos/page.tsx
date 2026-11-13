import { redirect } from "next/navigation";

// La descarga se hace desde el panel (maqueta v1); la dirección antigua lleva allí.
export default function DatosPagina() {
  redirect("/cuenta");
}
