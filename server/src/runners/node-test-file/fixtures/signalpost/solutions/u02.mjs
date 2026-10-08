// BootQuest seed-time fixture solution for signalpost U02-02 (authored by BootQuest, NOT shipped upstream).
// Fixes both starter defects: the off-by-one loop bound and the untrimmed, case-sensitive match.
export function findTitles(tasks, query) {
  const needle = query.trim().toLowerCase();
  const found = [];
  for (let i = 0; i < tasks.length; i++) {
    if (tasks[i].title.toLowerCase().includes(needle)) found.push(tasks[i].title);
  }
  return found;
}
