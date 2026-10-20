import { redirect } from "next/navigation";

export default function ErroresAdmin() {
  redirect("/admin/liga/revisar?vista=errores");
}
