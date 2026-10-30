// A value that follows `value` only after it has stopped changing for `delayMs`.
// Its first render returns `value` itself, so a live region fed by it is silent on mount and
// speaks once per pause in typing instead of once per keystroke.

import { useEffect, useState } from 'react';

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return settled;
}
