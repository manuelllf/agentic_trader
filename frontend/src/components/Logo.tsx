import Image from "next/image";

export default function Logo({ size = 40, className = "" }: { size?: number; className?: string }) {
  return (
    <Image
      src="/favicon.svg?v=vennett-6"
      alt="Vennett"
      width={size}
      height={size}
      className={className}
    />
  );
}
