import { redirect } from "next/navigation";

// Los planes viven en la cuenta, junto al resto de lo tuyo: esta ruta solo manda allí.
export default function Planes() {
  redirect("/cuenta");
}
