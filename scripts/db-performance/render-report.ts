import { readFile, writeFile } from 'node:fs/promises';
type Scan = { type: string; table?: string; index?: string; rows?: number; removed?: number };
type Timing = {
  medianMs: number;
  minMs: number;
  maxMs: number;
  scans: Scan[];
  sharedHits: number;
  sharedReads: number;
  roundMediansMs?: number[];
};
type Report = {
  generatedAt: string;
  version: string;
  measurement: unknown;
  indexes: Array<{ name: string; bytes: number }>;
  queries: Array<{ id: string; screen: string; source: string; before: Timing; after: Timing }>;
};
async function main() {
  const r = JSON.parse(await readFile('.cache/db-performance/results.json', 'utf8')) as Report;
  const scan = (t: Timing) =>
    t.scans
      .filter((s) => s.table)
      .map(
        (s) =>
          `${s.table}: ${s.type}${s.rows !== undefined ? ` (${s.rows} rows${s.removed ? `, ${s.removed} filtered` : ''})` : ''}`,
      )
      .join('; ');
  const ms = (n: number) => n.toFixed(3);
  const table = [
    '| Read query | Before ms | After ms | Before scan | After scan |',
    '| --- | ---: | ---: | --- | --- |',
    ...r.queries.map(
      (q) =>
        `| \`${q.id}\` | ${ms(q.before.medianMs)} | ${ms(q.after.medianMs)} | ${scan(q.before)} | ${scan(q.after)} |`,
    ),
  ].join('\n');
  const variation = [
    '| Read query | Before min–max ms | After min–max ms | Before hit/read blocks | After hit/read blocks |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...r.queries.map(
      (q) =>
        `| \`${q.id}\` | ${ms(q.before.minMs)}–${ms(q.before.maxMs)} | ${ms(q.after.minMs)}–${ms(q.after.maxMs)} | ${q.before.sharedHits}/${q.before.sharedReads} | ${q.after.sharedHits}/${q.after.sharedReads} |`,
    ),
  ].join('\n');
  const size = [
    '| New index | Synthetic size MiB |',
    '| --- | ---: |',
    ...r.indexes.map((i) => `| \`${i.name}\` | ${(i.bytes / 1048576).toFixed(3)} |`),
    `| Total | ${(r.indexes.reduce((sum, i) => sum + i.bytes, 0) / 1048576).toFixed(3)} |`,
  ].join('\n');
  const evidence = `Generated from a real local run at \`${r.generatedAt}\`. Engine: ${r.version}. Measurement: \`${JSON.stringify(r.measurement)}\`. Times below are PostgreSQL EXPLAIN execution medians in milliseconds. Scan row figures are per plan loop, not summed across nested join loops.\n\n${table}\n\n${variation}\n\n${size}\n`;
  const file = 'docs/DATABASE_PERFORMANCE.md';
  const doc = await readFile(file, 'utf8');
  await writeFile(
    file,
    doc.replace(
      /<!-- performance-evidence:start -->[\s\S]*?<!-- performance-evidence:end -->/,
      `<!-- performance-evidence:start -->\n${evidence}<!-- performance-evidence:end -->`,
    ),
  );
  console.info(
    'Updated synthetic read timings, plans and index sizes in docs/DATABASE_PERFORMANCE.md.',
  );
}
main().catch(() => {
  console.error('Synthetic report rendering failed; no live database or secret was read.');
  process.exitCode = 1;
});
