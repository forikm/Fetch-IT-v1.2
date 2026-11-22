"use client";
import { useEffect, useState } from 'react';

// Mount only while a request is pending; a new request gets a fresh timer.
export function SlowRequestFeedback({ message, initialMessage }: { message: string; initialMessage?: string }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 5000);
    return () => clearTimeout(timer);
  }, []);
  if (!slow && !initialMessage) return null;
  return <p role="status" className="text-sm text-muted-foreground">{slow ? message : initialMessage}</p>;
}
