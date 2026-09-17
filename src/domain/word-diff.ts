export type WordDiffToken = { value: string; kind: 'unchanged' | 'added' | 'removed' };

const words = (text: string): readonly string[] => text.match(/\s+|[^\s]+/g) ?? [];

/** Pure LCS-based word diff; presentation is intentionally left to the feature layer. */
export const diffWords = (before: string, after: string): readonly WordDiffToken[] => {
  const left = words(before); const right = words(after);
  const table = Array.from({ length: left.length + 1 }, () => Array<number>(right.length + 1).fill(0));
  for (let leftIndex = left.length - 1; leftIndex >= 0; leftIndex -= 1) for (let rightIndex = right.length - 1; rightIndex >= 0; rightIndex -= 1) {
    table[leftIndex]![rightIndex] = left[leftIndex] === right[rightIndex]
      ? table[leftIndex + 1]![rightIndex + 1]! + 1
      : Math.max(table[leftIndex + 1]![rightIndex]!, table[leftIndex]![rightIndex + 1]!);
  }
  const result: WordDiffToken[] = []; let leftIndex = 0; let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) { result.push({ value: left[leftIndex]!, kind: 'unchanged' }); leftIndex += 1; rightIndex += 1; }
    else if (table[leftIndex + 1]![rightIndex]! >= table[leftIndex]![rightIndex + 1]!) { result.push({ value: left[leftIndex]!, kind: 'removed' }); leftIndex += 1; }
    else { result.push({ value: right[rightIndex]!, kind: 'added' }); rightIndex += 1; }
  }
  while (leftIndex < left.length) { result.push({ value: left[leftIndex]!, kind: 'removed' }); leftIndex += 1; }
  while (rightIndex < right.length) { result.push({ value: right[rightIndex]!, kind: 'added' }); rightIndex += 1; }
  return result;
};
