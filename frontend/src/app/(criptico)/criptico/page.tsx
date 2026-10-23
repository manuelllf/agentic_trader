import { metadataCriptico, pagina } from "../_criptico/paginas";

export const generateMetadata = () => metadataCriptico("es");
export default function Page() { return pagina("es"); }
