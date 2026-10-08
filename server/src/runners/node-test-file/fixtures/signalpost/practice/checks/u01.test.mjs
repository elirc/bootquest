import { test } from "node:test";
import assert from "node:assert/strict";
import { remainingTitles, totalMinutes } from "../learner/u01.mjs";

test("remainingTitles preserves order and input", () => {
  const tasks = Object.freeze([
    Object.freeze({ title: "Read", done: false }),
    Object.freeze({ title: "Run", done: true }),
    Object.freeze({ title: "Write", done: false }),
  ]);
  assert.deepEqual(remainingTitles(tasks), ["Read", "Write"]);
  assert.deepEqual(remainingTitles([]), []);
});

test("totalMinutes combines every value including zero", () => {
  assert.equal(totalMinutes(Object.freeze([20, 0, 35])), 55);
  assert.equal(totalMinutes([]), 0);
  assert.equal(totalMinutes([7]), 7);
});
