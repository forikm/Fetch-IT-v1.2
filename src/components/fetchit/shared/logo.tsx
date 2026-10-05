// Brand logo + wordmark for Fetch-It.

import { cn } from "@/lib/utils";
import Image from "next/image";

export function FetchItLogo({
  className,
  showWordmark = true,
  size = 40,
}: {
  className?: string;
  showWordmark?: boolean;
  size?: number;
}) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <Image
        src="/fetch-logo-final.png"
        width={size}
        height={size}
        alt=""
        aria-hidden="true"
        className="shrink-0 object-contain"
        unoptimized
      />
      {showWordmark && (
        <span className="font-semibold text-xl tracking-[-0.05em]">
          Fetch<span className="text-[#bd4c1d] dark:text-[#ef9459]">-It</span>
        </span>
      )}
    </div>
  );
}
