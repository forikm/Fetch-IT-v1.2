import Image from "next/image";
import { cn } from "@/lib/utils";

// Keep the supplied GIF animated; show the still logo for reduced motion.
export function FetchItLoader({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn("inline-flex h-5 w-5 shrink-0 items-center justify-center", className)}>
      <picture className="contents">
        <source media="(prefers-reduced-motion: reduce)" srcSet="/fetch-logo-transparent.png" />
        <Image
          src="/fetch-loading.gif"
          alt=""
          width={96}
          height={96}
          className="h-full w-full rounded-full object-contain motion-reduce:rounded-none"
          unoptimized
        />
      </picture>
    </span>
  );
}

export function FetchItLoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background" role="status">
      <div className="flex flex-col items-center gap-5 text-muted-foreground">
        <FetchItLoader className="h-24 w-24" />
        <p className="text-sm">Loading Fetch-It…</p>
      </div>
    </div>
  );
}
