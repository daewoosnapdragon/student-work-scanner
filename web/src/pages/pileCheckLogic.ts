// The pile check's arithmetic, kept apart from the screen so it can be tested.

/** The sheet number to offer for a student: the guess's own when it has one, else the lowest the student still lacks, else 1. */
export function nextSheetNumber(lacking: number[], guessPage: number | null): number {
  if (guessPage != null) return guessPage
  return lacking.length ? Math.min(...lacking) : 1
}

/**
 * A pile scanned without codes, cut into packets over sheet numbers 1..N: packet k takes `sizes[k]`
 * sheets (the usual `perStudent` when not set), in pile order, so changing one packet's size shifts
 * the packets after it. Every packet takes at least one sheet.
 */
export function cutPackets(sheetCount: number, perStudent: number, sizes: number[]): number[][] {
  const out: number[][] = []
  let next = 1, k = 0
  while (next <= sheetCount) {
    const n = Math.max(1, sizes[k] ?? perStudent)
    const packet: number[] = []
    for (let i = 0; i < n && next <= sheetCount; i++) packet.push(next++)
    out.push(packet)
    k++
  }
  return out
}
