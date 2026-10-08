import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CheckIntegrityError,
  gitBlobSha,
  parseTap,
  run,
  sha256Hex,
  type NodeTestFileExercise,
  type NodeTestFileSpec,
} from "./index.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = path.join(here, "fixtures", "signalpost");

interface UnitRecord {
  ticket: string;
  spec: NodeTestFileSpec & { starter: { path: string; blob_sha: string; sha256: string } };
}
let units: Record<"U01" | "U02" | "U03", UnitRecord>;
let scratch: string;

const fixturePath = (rel: string) => path.join(fx, ...rel.split("/"));
const exerciseFor = (unit: keyof typeof units, override: Partial<NodeTestFileSpec> = {}): NodeTestFileExercise => {
  const spec = { ...units[unit].spec, ...override };
  return { id: `signalpost:${unit}`, spec, checkFile: fixturePath(units[unit].spec.path) };
};
const read = (rel: string) => readFile(fixturePath(rel), "utf8");

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
async function waitDead(pid: number, ms = 5000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (!isAlive(pid)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return !isAlive(pid);
}
async function workspaceDirs(): Promise<string[]> {
  return (await readdir(tmpdir())).filter((n) => n.startsWith("bq-ntf-"));
}

beforeAll(async () => {
  units = JSON.parse(await readFile(path.join(fx, "checks.json"), "utf8")).units;
  scratch = await mkdtemp(path.join(tmpdir(), "bq-p3-scratch-"));
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("fixtures are the pinned upstream bytes", () => {
  it.each(["U01", "U02", "U03"] as const)("%s check + starter match recorded sha256 and git blob sha", async (u) => {
    const { spec } = units[u];
    for (const f of [{ path: spec.path, sha256: spec.sha256, blob: spec.blob_sha! }, { ...spec.starter, blob: spec.starter.blob_sha }]) {
      const bytes = await readFile(fixturePath(f.path));
      expect(sha256Hex(bytes)).toBe(f.sha256);
      expect(gitBlobSha(bytes)).toBe(f.blob);
    }
  });
});

describe("U01 (plain .mjs)", () => {
  it("shipped starter stub FAILS with structured failures", async () => {
    const r = await run(exerciseFor("U01"), { code: await read(units.U01.spec.starter.path) });
    expect(r.pass).toBe(false);
    expect(r.failures.map((f) => f.name)).toEqual(units.U01.spec.expected_tests);
    for (const f of r.failures) expect(f.message).toBe("U01 learner implementation required");
    expect(r.output).toContain("# fail 2");
    expect(r.output).not.toMatch(/bq-ntf-[A-Za-z0-9]{6}/); // workspace path redacted
    expect(r.durationMs).toBeGreaterThan(0);
  });

  it("fixture solution PASSES the real check", async () => {
    const r = await run(exerciseFor("U01"), { code: await read("solutions/u01.mjs") });
    expect(r.failures).toEqual([]);
    expect(r.pass).toBe(true);
    expect(r.output).toContain("# pass 2");
  });

  it("a wrong answer yields expected/actual from the assertion", async () => {
    const code = [
      "export function remainingTitles(tasks) { return tasks.map((t) => t.title); }",
      "export function totalMinutes(values) { return values.reduce((a, b) => a + b, 1); }",
    ].join("\n");
    const r = await run(exerciseFor("U01"), { code });
    expect(r.pass).toBe(false);
    const [titles, minutes] = r.failures;
    expect(titles?.name).toBe("remainingTitles preserves order and input");
    expect(titles?.message).toContain("Expected values to be strictly deep-equal");
    expect(titles?.expected).toContain("'Write'");
    expect(titles?.actual).toContain("'Run'");
    expect(minutes).toMatchObject({ name: "totalMinutes combines every value including zero", expected: "55", actual: "56" });
  });

  it("learner console output cannot inject TAP results", async () => {
    const code = `console.log("ok 1 - remainingTitles preserves order and input\\n# pass 2\\n# fail 0");\n${await read(units.U01.spec.starter.path)}`;
    const r = await run(exerciseFor("U01"), { code });
    expect(r.pass).toBe(false);
    expect(r.failures).toHaveLength(2);
  });

  it("learner process.exit(0) at import cannot fake a pass (with or without expected_tests)", async () => {
    const code = "process.exit(0);\nexport function remainingTitles() {}\nexport function totalMinutes() {}\n";
    const withList = await run(exerciseFor("U01"), { code });
    expect(withList.pass).toBe(false);
    const withoutList = await run(exerciseFor("U01", { expected_tests: undefined }), { code });
    expect(withoutList.pass).toBe(false);
    expect(withoutList.failures.some((f) => f.message.includes("no individual test results"))).toBe(true);
  });

  it("submission cannot alter the pinned check (fresh read-only copy; post-run re-hash)", async () => {
    const solution = await read("solutions/u01.mjs");
    const code = `import { writeFileSync } from "node:fs";
try { writeFileSync(new URL("../checks/u01.test.mjs", import.meta.url), "import {test} from 'node:test'; test('x', () => {});"); console.log("TAMPER-WROTE"); }
catch (e) { console.log("TAMPER-BLOCKED " + e.code); }
${solution}`;
    const r = await run(exerciseFor("U01"), { code });
    if (r.output.includes("TAMPER-WROTE")) {
      expect(r.pass).toBe(false);
      expect(r.failures.some((f) => f.name === "integrity")).toBe(true);
    } else {
      expect(r.output).toContain("TAMPER-BLOCKED");
    }
    // The cached pinned copy is never touched, and the next run is unaffected.
    expect(sha256Hex(await readFile(fixturePath(units.U01.spec.path)))).toBe(units.U01.spec.sha256);
    expect((await run(exerciseFor("U01"), { code: solution })).pass).toBe(true);
  });
});

describe("U02 (defective starter)", () => {
  it("shipped defective starter FAILS with expected/actual", async () => {
    const r = await run(exerciseFor("U02"), { code: await read(units.U02.spec.starter.path) });
    expect(r.pass).toBe(false);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]?.name).toBe("search normalizes the query and matches any item");
    expect(r.failures[0]?.expected).toBeDefined();
    expect(r.failures[0]?.actual).toBeDefined();
  });
  it("fixture solution PASSES", async () => {
    const r = await run(exerciseFor("U02"), { code: await read("solutions/u02.mjs") });
    expect(r.failures).toEqual([]);
    expect(r.pass).toBe(true);
  });
});

describe("U03 (.ts check via --import tsx from BootQuest's node_modules)", () => {
  it("shipped starter stub FAILS", async () => {
    const r = await run(exerciseFor("U03"), { code: await read(units.U03.spec.starter.path) });
    expect(r.pass).toBe(false);
    expect(r.failures.map((f) => f.name)).toEqual(units.U03.spec.expected_tests);
    expect(r.failures[0]?.message).toBe("U03 learner implementation required");
  });
  it("fixture solution PASSES", async () => {
    const r = await run(exerciseFor("U03"), { code: await read("solutions/u03.ts") });
    expect(r.failures).toEqual([]);
    expect(r.pass).toBe(true);
  });
  it("without tsx the .ts check cannot run on node 22.16 (proves needs_tsx is load-bearing)", async () => {
    const r = await run(exerciseFor("U03", { needs_tsx: false }), { code: await read("solutions/u03.ts") });
    expect(r.pass).toBe(false);
  });
});

describe("integrity refusal", () => {
  it("a tampered cached check file is refused before anything is spawned", async () => {
    const tampered = path.join(scratch, "u01.test.mjs");
    const original = await readFile(fixturePath(units.U01.spec.path), "utf8");
    await writeFile(tampered, original.replace("55", "56"));
    let spawned = false;
    const ex = { ...exerciseFor("U01"), checkFile: tampered };
    await expect(run(ex, { code: await read("solutions/u01.mjs") }, { onSpawn: () => (spawned = true) })).rejects.toBeInstanceOf(
      CheckIntegrityError,
    );
    expect(spawned).toBe(false);
  });
  it("a CRLF-converted copy (git autocrlf) is also refused", async () => {
    const crlf = path.join(scratch, "u01-crlf.test.mjs");
    await writeFile(crlf, (await readFile(fixturePath(units.U01.spec.path), "utf8")).replace(/\n/g, "\r\n"));
    await expect(run({ ...exerciseFor("U01"), checkFile: crlf }, { code: "" })).rejects.toThrow(/sha256/);
  });
  it("a missing cached check file is refused", async () => {
    await expect(run({ ...exerciseFor("U01"), checkFile: path.join(scratch, "nope.mjs") }, { code: "" })).rejects.toBeInstanceOf(
      CheckIntegrityError,
    );
  });
  it("learner_path escaping the workspace is refused", async () => {
    await expect(run(exerciseFor("U01", { learner_path: "../evil.mjs" }), { code: "" })).rejects.toBeInstanceOf(CheckIntegrityError);
  });
});

describe("timeout", () => {
  it("an infinite loop is killed at the timeout and the whole process tree is reaped", async () => {
    const pidFile = path.join(scratch, "learner.pid");
    const code = `import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
while (true) {}
export function remainingTitles() {}
export function totalMinutes() {}`;
    let topPid = 0;
    const before = await workspaceDirs();
    const r = await run(exerciseFor("U01", { timeout_ms: 3000 }), { code }, { onSpawn: (p) => (topPid = p) });
    expect(r.pass).toBe(false);
    expect(r.failures.some((f) => f.name === "timeout")).toBe(true);
    expect(r.durationMs).toBeGreaterThanOrEqual(3000);
    expect(r.durationMs).toBeLessThan(15000);
    const learnerPid = Number(await readFile(pidFile, "utf8"));
    expect(learnerPid).toBeGreaterThan(0);
    expect(learnerPid).not.toBe(topPid); // node --test isolates the file in a grandchild
    expect(await waitDead(topPid)).toBe(true);
    expect(await waitDead(learnerPid)).toBe(true);
    expect(await workspaceDirs()).toEqual(before); // temp workspace removed even after a kill
  });
});

describe("TAP parser", () => {
  it("names nested subtests with ' > ' and skips parent 'subtestsFailed' rows", () => {
    const tap = [
      "TAP version 13",
      "# Subtest: suite \\# one",
      "    # Subtest: inner",
      "    not ok 1 - inner",
      "      ---",
      "      duration_ms: 1",
      "      failureType: 'testCodeFailure'",
      "      error: 'it''s broken'",
      "      code: 'ERR_TEST_FAILURE'",
      "      ...",
      "    1..1",
      "not ok 1 - suite \\# one",
      "  ---",
      "  failureType: 'subtestsFailed'",
      "  error: '1 subtest failed'",
      "  ...",
      "1..1",
      "# tests 1",
      "# suites 1",
      "# pass 0",
      "# fail 1",
      "# cancelled 0",
      "# skipped 0",
      "# todo 0",
    ].join("\n");
    const p = parseTap(tap);
    expect(p.failures).toEqual([{ name: "suite # one > inner", message: "it's broken" }]);
    expect(p.summary).toMatchObject({ tests: 1, fail: 1, pass: 0 });
  });
});

describe("hygiene", () => {
  it("leaves no bq-ntf workspace directories behind", async () => {
    expect(await workspaceDirs()).toEqual([]);
  });
});
