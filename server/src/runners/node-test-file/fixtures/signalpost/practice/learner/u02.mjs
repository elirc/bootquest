// U02-02. Deliberately defective, isolated learning code.
// Reproduce and diagnose using the written contract, then make a small fix.
export function findTitles(tasks, query) {
  const found = [];
  for (let i = 0; i < tasks.length - 1; i++) {
    if (tasks[i].title.includes(query)) found.push(tasks[i].title);
  }
  return found;
}
