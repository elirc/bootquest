// BootQuest seed-time fixture solution for signalpost U01-02 (authored by BootQuest, NOT shipped upstream).
// Validated by the real upstream check practice/checks/u01.test.mjs via the node-test-file runner.
// Valid input only. Never mutates caller-owned arrays or objects.
export function remainingTitles(tasks) {
  const titles = [];
  for (const task of tasks) {
    if (task.done === false) titles.push(task.title);
  }
  return titles;
}

export function totalMinutes(values) {
  let total = 0;
  for (const minutes of values) total += minutes;
  return total;
}
