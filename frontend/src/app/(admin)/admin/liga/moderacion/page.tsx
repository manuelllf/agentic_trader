import { redirect } from "next/navigation";

export default function ModeracionAdmin() {
  redirect("/admin/liga/revisar?vista=moderacion");
}
