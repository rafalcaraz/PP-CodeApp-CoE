import { useEffect, useState } from "react";

/** Returns `value` after it has been stable for `delay` ms. Useful for
 *  pushing user-typed search queries down to the server without thrashing. */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return debounced;
}
