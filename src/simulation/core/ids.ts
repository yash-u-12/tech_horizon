let counters: Record<string, number> = {};

export function resetIds() {
  counters = {};
}

export function nextId(prefix: string) {
  counters[prefix] = (counters[prefix] ?? 0) + 1;
  return `${prefix}-${counters[prefix].toString().padStart(4, '0')}`;
}

/** Deterministic short uid used for plans, events and conflicts. */
export function shortId(prefix: string, n: number) {
  return `${prefix}-${n.toString(36).toUpperCase().padStart(4, '0')}`;
}
