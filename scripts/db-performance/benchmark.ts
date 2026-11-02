import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createFixture, asTenant } from './fixture';
import { assertReadOnlySelect, mainReadQueries, type ReadQuery } from './queries';
import { proposedIndexes } from './indexes';

type PlanNode = {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Name'?: string;
  'Actual Rows'?: number;
  'Rows Removed by Filter'?: number;
  'Shared Hit Blocks'?: number;
  'Shared Read Blocks'?: number;
  Plans?: PlanNode[];
};
type Explain = { Plan: PlanNode; 'Planning Time': number; 'Execution Time': number };
function nodes(plan: PlanNode): PlanNode[] {
  return [plan, ...(plan.Plans ?? []).flatMap(nodes)];
}
async function measure(db: Awaited<ReturnType<typeof createFixture>>['db'], query: ReadQuery) {
  assertReadOnlySelect(query.sql);
  if (/^(admin|worker)_/.test(query.id)) await db.exec('reset role');
  else await asTenant(db);
  const samples: Explain[] = [];
  for (let i = 0; i < 6; i++) {
    const result = await db.query<{ 'QUERY PLAN': Explain[] }>(
      `explain (analyze,buffers,format json) ${query.sql}`,
      query.params,
    );
    if (i > 0) samples.push(result.rows[0]['QUERY PLAN'][0]);
  }
  samples.sort((a, b) => a['Execution Time'] - b['Execution Time']);
  const middle = samples[2];
  const scans = nodes(middle.Plan).filter((n) => /Scan/.test(n['Node Type']));
  return {
    medianMs: middle['Execution Time'],
    planningMs: middle['Planning Time'],
    minMs: samples[0]['Execution Time'],
    maxMs: samples.at(-1)!['Execution Time'],
    scans: scans.map((s) => ({
      type: s['Node Type'],
      table: s['Relation Name'],
      index: s['Index Name'],
      rows: s['Actual Rows'],
      removed: s['Rows Removed by Filter'] ?? 0,
    })),
    sharedHits: middle.Plan['Shared Hit Blocks'] ?? 0,
    sharedReads: middle.Plan['Shared Read Blocks'] ?? 0,
    plan: middle,
    sampleTimesMs: samples.map((sample) => sample['Execution Time']),
  };
}
async function main() {
  const { db, counts } = await createFixture('large');
  try {
    const version = (await db.query<{ version: string }>('select version()')).rows[0].version;
    const cycles: Array<{
      before: Record<string, Awaited<ReturnType<typeof measure>>>;
      after: Record<string, Awaited<ReturnType<typeof measure>>>;
    }> = [];
    const indexes: Array<(typeof proposedIndexes)[number] & { bytes: number }> = [];
    // Two paired rounds retain the exact same rows and table statistics. Drop
    // only the new synthetic indexes between rounds; no production connection.
    for (let cycle = 0; cycle < 2; cycle++) {
      const before: Record<string, Awaited<ReturnType<typeof measure>>> = {};
      for (const q of mainReadQueries) before[q.id] = await measure(db, q);
      console.info(
        `Synthetic baseline round ${cycle + 1}/2 complete (${mainReadQueries.length} read SELECTs).`,
      );
      await db.exec('reset role');
      for (const index of proposedIndexes) {
        await db.exec(index.sql);
        if (cycle === 0)
          indexes.push({
            ...index,
            bytes: Number(
              (
                await db.query<{ bytes: string }>(
                  'select pg_relation_size($1::regclass)::text bytes',
                  [`public.${index.name}`],
                )
              ).rows[0].bytes,
            ),
          });
      }
      const after: Record<string, Awaited<ReturnType<typeof measure>>> = {};
      for (const q of mainReadQueries) after[q.id] = await measure(db, q);
      cycles.push({ before, after });
      console.info(`Synthetic indexed round ${cycle + 1}/2 complete.`);
      await db.exec('reset role');
      if (cycle === 0)
        for (const index of proposedIndexes) await db.exec(`drop index public.${index.name}`);
    }
    function combine(id: string, phase: 'before' | 'after') {
      const records = cycles.map((c) => c[phase][id]);
      const times = records.flatMap((r) => r.sampleTimesMs).sort((a, b) => a - b);
      return {
        ...records[0],
        medianMs: (times[4] + times[5]) / 2,
        minMs: times[0],
        maxMs: times.at(-1)!,
        sampleTimesMs: times,
        roundMediansMs: records.map((r) => r.medianMs),
        representativePlan: 'round 1 median; full plans/timings for both rounds are retained below',
      };
    }
    await db.exec('reset role');
    const output = {
      generatedAt: new Date().toISOString(),
      environment:
        'PGlite PostgreSQL WASM; synthetic data; one process; local warm-cache EXPLAIN ANALYZE execution time, not network/API latency',
      version,
      counts,
      measurement: {
        rounds: 2,
        warmupsPerRound: 1,
        samplesPerRound: 5,
        samplesPerPhase: 10,
        statistic:
          'median across 10 measured executions per phase; one warmup per paired round; same table statistics; no ANALYZE between phases',
      },
      indexes,
      queries: mainReadQueries.map((q) => ({
        id: q.id,
        screen: q.screen,
        source: q.source,
        before: combine(q.id, 'before'),
        after: combine(q.id, 'after'),
        rounds: cycles.map((cycle, i) => ({
          round: i + 1,
          before: cycle.before[q.id],
          after: cycle.after[q.id],
        })),
      })),
    };
    await mkdir(resolve('.cache/db-performance'), { recursive: true });
    await writeFile(
      resolve('.cache/db-performance/results.json'),
      JSON.stringify(output, null, 2) + '\n',
    );
    console.info('Synthetic plans and timings saved to .cache/db-performance/results.json');
  } finally {
    await db.close();
  }
}
main().catch(() => {
  console.error('Synthetic benchmark failed. No hosted database was used.');
  process.exitCode = 1;
});
