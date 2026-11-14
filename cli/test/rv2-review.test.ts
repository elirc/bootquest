import { describe, expect, it } from 'vitest';
import { runCli } from '../src/program.ts';

/** rv2 S1: `bootquest review [--keyideas] [--tag x]` lists what is due (read-only; grading happens in the app). */
describe('rv2: bootquest review', () => {
  const run = async (args: string[], body: unknown) => {
    const out: string[] = [];
    const urls: string[] = [];
    let code: number | undefined;
    const fetch = (async (url: string) => {
      urls.push(String(url));
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as never;
    code = await runCli(args, { out: (t) => out.push(t), err: (t) => out.push(`ERR ${t}`), cwd: process.cwd(), env: {}, fetch });
    return { out: out.join('\n'), urls, code };
  };

  it('--keyideas --tag reads the interleaved session and names the section of each card', async () => {
    const r = await run(['review', '--keyideas', '--tag', 'idempotency'], {
      count: 2,
      items: [
        { cardKey: 'keyidea:a/x', card: { front: 'Why is the retry safe?\nmore' }, keyIdea: { sectionTitle: 'JS: senior CRUD' } },
        { cardKey: 'keyidea:b/y', card: { front: 'What does the consumer record?' }, keyIdea: { sectionTitle: 'DESIGN IT' } },
      ],
      tags: [{ tag: 'idempotency', count: 2 }],
    });
    expect(r.urls[0]).toMatch(/\/api\/keyideas\/queue\?limit=12&tag=idempotency$/);
    expect(r.out).toContain('2 key-idea cards tagged idempotency due.');
    expect(r.out).toContain(' 1. [JS: senior CRUD] Why is the retry safe?');
    expect(r.out).not.toContain('more');
    expect(r.out).toContain('/review?mode=keyideas&tag=idempotency');
    expect(r.code).toBe(0);
  });

  it('plain review lists the whole queue; --tag without --keyideas is a usage error', async () => {
    const r = await run(['review'], { count: 0, items: [] });
    expect(r.urls[0]).toMatch(/\/api\/reviews\/queue\?limit=12$/);
    expect(r.out).toContain('0 cards due.');
    const bad = await run(['review', '--tag', 'x'], { count: 0, items: [] });
    expect(bad.urls).toEqual([]);
    expect(bad.code).toBe(2);
  });
});
