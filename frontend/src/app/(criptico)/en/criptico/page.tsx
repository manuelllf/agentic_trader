import { metadataCriptico, pagina } from "../../_criptico/paginas";

export const generateMetadata = () => metadataCriptico("en");
export default function Page() { return pagina("en"); }
