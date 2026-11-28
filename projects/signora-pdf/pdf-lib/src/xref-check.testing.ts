/**
 * A strict, independent reader of the cross-reference chain of a PDF, used by tests to check what
 * the incremental writer produces. Unlike PDF readers it does NOT recover from errors: any
 * inconsistency throws. It does not share code with the writer.
 */
export interface XrefReport {
  /** Section kinds from the newest to the oldest. */
  readonly kinds: readonly ('table' | 'stream')[];
  /** Object numbers each section lists (stream sections that are compressed list nothing). */
  readonly entries: readonly (readonly number[])[];
}

const latin1 = (bytes: Uint8Array, from: number, to: number): string =>
  String.fromCharCode(...bytes.subarray(from, Math.min(to, bytes.length)));

export function checkXrefChain(pdf: Uint8Array): XrefReport {
  const tail = latin1(pdf, Math.max(0, pdf.length - 64), pdf.length);
  const ending = /startxref\r?\n(\d+)\r?\n%%EOF\r?\n?$/.exec(tail);
  if (!ending) throw new Error('The file does not end with "startxref <offset> %%EOF".');

  const kinds: ('table' | 'stream')[] = [];
  const entries: number[][] = [];
  const seen = new Set<number>();
  let offset: number | undefined = Number(ending[1]);

  while (offset !== undefined) {
    if (seen.has(offset)) throw new Error(`/Prev loop at ${offset}.`);
    seen.add(offset);
    if (offset <= 0 || offset >= pdf.length)
      throw new Error(`xref offset ${offset} is outside the file.`);

    const numbers: number[] = [];
    let prev: number | undefined;

    if (latin1(pdf, offset, offset + 5) === 'xref\n') {
      kinds.push('table');
      let cursor: number = offset + 5;
      for (;;) {
        const line = latin1(pdf, cursor, cursor + 40).split('\n')[0];
        if (line === '') {
          cursor += 1; // pdf-lib leaves a blank line before the trailer
          continue;
        }
        if (line === 'trailer') break;
        const header = /^(\d+) (\d+)$/.exec(line);
        if (!header) throw new Error(`Bad xref subsection header "${line}" at ${cursor}.`);
        cursor += line.length + 1;
        for (let i = 0; i < Number(header[2]); i++) {
          const entry = latin1(pdf, cursor, cursor + 20);
          if (!/^\d{10} \d{5} [nf] \n$/.test(entry)) throw new Error(`Bad xref entry "${entry}".`);
          if (entry[17] === 'n') {
            const number = Number(header[1]) + i;
            const target = Number(entry.slice(0, 10));
            const generation = Number(entry.slice(11, 16));
            const expected = `${number} ${generation} obj`;
            if (latin1(pdf, target, target + expected.length) !== expected) {
              throw new Error(
                `Entry for object ${number} points to ${target}, which is not "${expected}".`,
              );
            }
            numbers.push(number);
          }
          cursor += 20;
        }
      }
      const trailer: string = latin1(pdf, cursor, cursor + 2048).split('startxref')[0];
      prev = /\/Prev\s+(\d+)/.exec(trailer)?.[1]
        ? Number(/\/Prev\s+(\d+)/.exec(trailer)![1])
        : undefined;
    } else {
      kinds.push('stream');
      const head = latin1(pdf, offset, offset + 4096);
      const dictionary = head.slice(0, head.indexOf('stream'));
      if (!/^\d+ \d+ obj\s*<</.test(dictionary) || !/\/Type\s*\/XRef/.test(dictionary)) {
        throw new Error(`No xref stream at ${offset}.`);
      }
      const widths = /\/W\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(dictionary);
      const index = /\/Index\s*\[([^\]]*)\]/.exec(dictionary);
      const length = /\/Length\s+(\d+)/.exec(dictionary);
      if (!widths || !length) throw new Error('xref stream without /W or /Length.');
      const prevMatch = /\/Prev\s+(\d+)/.exec(dictionary);
      prev = prevMatch ? Number(prevMatch[1]) : undefined;

      if (!/\/Filter/.test(dictionary)) {
        const [w0, w1, w2] = [Number(widths[1]), Number(widths[2]), Number(widths[3])];
        const start = offset + head.indexOf('stream') + 'stream\n'.length;
        const ranges = (index?.[1] ?? '0 0').trim().split(/\s+/).map(Number);
        let cursor = start;
        const read = (width: number) => {
          let value = 0;
          for (let i = 0; i < width; i++) value = value * 256 + pdf[cursor++];
          return value;
        };
        for (let r = 0; r < ranges.length; r += 2) {
          for (let i = 0; i < ranges[r + 1]; i++) {
            const type = w0 === 0 ? 1 : read(w0);
            const field2 = read(w1);
            const field3 = read(w2);
            const number = ranges[r] + i;
            if (type === 1) {
              const expected = `${number} ${field3} obj`;
              if (latin1(pdf, field2, field2 + expected.length) !== expected) {
                throw new Error(
                  `Stream entry for object ${number} points to ${field2}, not "${expected}".`,
                );
              }
              numbers.push(number);
            }
          }
        }
        if (cursor - start !== Number(length[1]))
          throw new Error('xref stream /Length does not match its entries.');
        if (latin1(pdf, cursor, cursor + 10) !== '\nendstream')
          throw new Error('xref stream is not closed.');
      }
    }
    entries.push(numbers);
    offset = prev;
  }
  return { kinds, entries };
}
