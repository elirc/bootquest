import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTask } from "../learner/u03.ts";

test("valid input is normalized without mutation", () => {
  const input = Object.freeze({
    title: "  Read  ",
    minutes: 25,
    extra: "ignored",
  });
  assert.deepEqual(parseTask(input), {
    ok: true,
    task: { title: "Read", minutes: 25 },
  });
  assert.equal(input.title, "  Read  ");
});

test("untrusted shapes and boundaries are rejected explicitly", () => {
  for (const value of [
    null,
    [],
    "task",
    {},
    { title: " ", minutes: 20 },
    { title: "x".repeat(81), minutes: 20 },
    { title: "Read", minutes: 0 },
    { title: "Read", minutes: 241 },
    { title: "Read", minutes: 1.5 },
    { title: "Read", minutes: "20" },
    { title: "Read", minutes: NaN },
  ]) {
    const result = parseTask(value);
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.error.trim().length > 0);
  }
});
