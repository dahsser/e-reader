/**
 * Pick the next page to render: wanted and not yet rendered; visible pages
 * first, then nearest by `distance` (ties: lowest index). -1 if none.
 */
export function pickNextPage(
  want: ReadonlySet<number>,
  rendered: ReadonlySet<number>,
  visible: ReadonlySet<number>,
  distance: (i: number) => number,
): number {
  let best = -1;
  let bestVisible = false;
  let bestDist = Infinity;
  for (const i of want) {
    if (rendered.has(i)) continue;
    const v = visible.has(i);
    const d = distance(i);
    const better =
      best === -1 ||
      (v && !bestVisible) ||
      (v === bestVisible && (d < bestDist || (d === bestDist && i < best)));
    if (better) {
      best = i;
      bestVisible = v;
      bestDist = d;
    }
  }
  return best;
}
