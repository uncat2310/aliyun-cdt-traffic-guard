import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseServerHistory, appendTrafficLog } from '../src/history.js';

const line = (stamp, gb) => `${stamp},123 - INFO - 当月CDT流量使用: ${gb} GB\n`;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tg-history-'));

test('aggregates hourly points and daily deltas', async () => {
  const file = path.join(tmp(), 'a.log');
  fs.writeFileSync(file, [
    line('2026-10-01 00:05:00', '1.00'),
    line('2026-10-01 00:50:00', '1.50'),
    line('2026-10-01 23:00:00', '4.00'),
    'garbage\n',
    line('2026-10-02 08:00:00', '1.2.3'),
    line('2026-10-02 09:00:00', '6.25'),
  ].join(''));
  const hist = await parseServerHistory([file]);
  assert.deepEqual(hist.hourly, [
    { time: '2026-10-01 00:00', traffic_gb: 1.5 },
    { time: '2026-10-01 23:00', traffic_gb: 4 },
    { time: '2026-10-02 09:00', traffic_gb: 6.25 },
  ]);
  assert.deepEqual(hist.daily, [
    { date: '2026-10-01', delta_gb: 3, cum_gb: 4 },
    { date: '2026-10-02', delta_gb: 2.25, cum_gb: 6.25 },
  ]);
});

test('reads incrementally, defers partial lines and handles truncation', async () => {
  const file = path.join(tmp(), 'b.log');
  fs.writeFileSync(file, line('2026-10-01 00:00:00', '1.00'));
  assert.equal((await parseServerHistory([file])).hourly.length, 1);

  fs.appendFileSync(file, '2026-10-01 01:00:00,000 - INFO - 当月CDT流量使用: 2.00 GB');
  assert.equal((await parseServerHistory([file])).hourly.length, 1);
  fs.appendFileSync(file, '\n');
  assert.equal((await parseServerHistory([file])).hourly.length, 2);

  fs.writeFileSync(file, line('2026-10-05 00:00:00', '9.00'));
  assert.deepEqual((await parseServerHistory([file])).hourly, [{ time: '2026-10-05 00:00', traffic_gb: 9 }]);
});

test('earlier entries in log_files take priority', async () => {
  const dir = tmp();
  const [primary, legacy] = [path.join(dir, 'p.log'), path.join(dir, 'l.log')];
  fs.writeFileSync(primary, line('2026-10-01 00:00:00', '5.00'));
  fs.writeFileSync(legacy, line('2026-10-01 00:10:00', '3.00'));
  assert.equal((await parseServerHistory([primary, legacy])).hourly[0].traffic_gb, 5);
});

test('appendTrafficLog writes the shared log format', async () => {
  const dir = tmp();
  const cfg = {};
  await appendTrafficLog('s1', cfg, 12.345, dir);
  const file = path.join(dir, 's1.log');
  assert.deepEqual(cfg.log_files, [file]);
  assert.match(fs.readFileSync(file, 'utf8'), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d{3} - INFO - 当月CDT流量使用: 12\.35 GB\n$/);
  assert.equal((await parseServerHistory([file])).hourly[0].traffic_gb, 12.35);
});
