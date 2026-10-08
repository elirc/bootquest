import { test } from "node:test";
import assert from "node:assert/strict";
import { findTitles } from "../learner/u02.mjs";

test("search normalizes the query and matches any item", () => {
  const tasks = Object.freeze([
    Object.freeze({ title: "Read a book" }),
    Object.freeze({ title: "Write a test" }),
    Object.freeze({ title: "READ the error" }),
  ]);
  assert.deepEqual(findTitles(tasks, " read "), [
    "Read a book",
    "READ the error",
  ]);
  assert.deepEqual(findTitles(tasks, "error"), ["READ the error"]);
  assert.deepEqual(
    findTitles(tasks, "   "),
    tasks.map((t) => t.title),
  );
  assert.deepEqual(findTitles(tasks, "unmatched"), []);
});
