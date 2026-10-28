import "@/app/(blog)/_blog/blog.css";

export default function FirmaAutor({ texto }: { texto: string }) {
  return <p className="firma-autor">{texto}</p>;
}
