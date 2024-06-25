export function range(start: number, end?: number) {
  if (end === undefined) {
    return [...Array(start).keys()];
  }

  return [...Array(end - start).keys()].map((n) => n + start);
}
