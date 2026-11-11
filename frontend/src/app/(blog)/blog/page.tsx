import { Listado, metadataBlog } from "../_blog/paginas";

export const revalidate = 300;
export const generateMetadata = () => metadataBlog("es");
export default function Page() {
  return <Listado idioma="es" />;
}
