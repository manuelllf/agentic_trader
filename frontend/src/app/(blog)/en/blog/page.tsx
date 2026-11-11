import { Listado, metadataBlog } from "../../_blog/paginas";

export const revalidate = 300;
export const generateMetadata = () => metadataBlog("en");
export default function Page() {
  return <Listado idioma="en" />;
}
