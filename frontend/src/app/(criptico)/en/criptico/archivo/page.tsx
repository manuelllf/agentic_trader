import { metadataArchivoLista, paginaArchivo } from "../../../_criptico/paginas";

export const generateMetadata = () => metadataArchivoLista("en");
export default function Page() { return paginaArchivo("en"); }
