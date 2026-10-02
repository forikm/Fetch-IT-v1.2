import { Button } from "@/components/ui/button";

export function RequestError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div role="alert" className="rounded-xl border border-destructive/25 bg-destructive/5 p-4 space-y-3">
    <p className="text-sm text-destructive">{message}</p>
    <Button type="button" size="sm" variant="outline" onClick={onRetry}>Try again</Button>
  </div>;
}
