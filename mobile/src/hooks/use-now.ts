import { useEffect, useState } from "react";

/**
 * The current time, refreshed every `everyMs`. Screens use it for things that change with the
 * clock (a call opening at 9:50) without reading the clock during render, which the React
 * Compiler doesn't allow.
 */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}
