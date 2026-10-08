package todo.service;

import java.io.IOException;
import java.time.Clock;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import todo.model.Task;
import todo.repository.TaskRepository;
import todo.repository.TaskSnapshot;

/** Candidate state becomes visible in memory only after persistence accepts it. */
public final class TaskManager {
    private final TaskRepository repository;
    private final Clock clock;
    private TaskSnapshot snapshot;
    public TaskManager(TaskRepository repository) throws IOException { this(repository, Clock.systemDefaultZone()); }
    public TaskManager(TaskRepository repository, Clock clock) throws IOException {
        this.repository = repository; this.clock = clock; snapshot = repository.load();
    }
    public synchronized void reload() throws IOException { snapshot = repository.load(); }
    public synchronized long revision() { return snapshot.revision(); }
    public synchronized List<Task> getAllTasks() { return snapshot.tasks().stream().sorted(Comparator.comparingInt(Task::getId)).toList(); }
    public synchronized Task findTaskById(int id) {
        return snapshot.tasks().stream().filter(t -> t.getId() == id).findFirst().orElseThrow(() -> new IllegalArgumentException("Task not found."));
    }
    private void commit(List<Task> tasks, long nextId) throws IOException {
        if (snapshot.revision() == Long.MAX_VALUE) throw new IllegalStateException("Snapshot revision exhausted.");
        TaskSnapshot candidate = new TaskSnapshot(snapshot.revision() + 1, nextId, tasks);
        repository.save(candidate); snapshot = candidate;
    }
    public synchronized Task addTask(String title, String description) throws IOException {
        if (snapshot.nextId() > Integer.MAX_VALUE) throw new IllegalStateException("Task ids exhausted.");
        Task task = new Task((int)snapshot.nextId(), title, description, false, LocalDateTime.now(clock), null);
        var tasks = new ArrayList<>(snapshot.tasks()); tasks.add(task); commit(tasks, snapshot.nextId() + 1); return task;
    }
    private Task expected(int id, int version) {
        Task task = findTaskById(id);
        if (task.getVersion() != version) throw new IllegalStateException("Task version changed. Reload and review before retrying.");
        return task;
    }
    private Task replace(Task replacement) throws IOException {
        var tasks = new ArrayList<>(snapshot.tasks());
        tasks.replaceAll(t -> t.getId() == replacement.getId() ? replacement : t);
        commit(tasks, snapshot.nextId()); return replacement;
    }
    public synchronized Task editTask(int id, int version, String title, String description) throws IOException {
        return replace(expected(id, version).edit(title, description));
    }
    public synchronized Task setCompleted(int id, int version, boolean completed) throws IOException {
        Task old = expected(id, version); Task replacement = old.withCompletion(completed, LocalDateTime.now(clock));
        return replacement == old ? old : replace(replacement);
    }
    public synchronized void deleteTask(int id, int version) throws IOException {
        expected(id, version); var tasks = new ArrayList<>(snapshot.tasks()); tasks.removeIf(t -> t.getId() == id); commit(tasks, snapshot.nextId());
    }
    public synchronized List<Task> search(String query, String status) {
        if (query == null || query.length() > 160 || !List.of("all", "open", "done").contains(status)) throw new IllegalArgumentException("Invalid search or status.");
        String q = query.strip().toLowerCase(Locale.ROOT);
        return getAllTasks().stream().filter(t -> status.equals("all") || (status.equals("done") == t.isCompleted()))
                .filter(t -> (t.getTitle() + " " + t.getDescription()).toLowerCase(Locale.ROOT).contains(q)).toList();
    }
    public String formatTaskForDisplay(Task t) {
        return (t.isCompleted() ? "[X] " : "[ ] ") + "ID " + t.getId() + " / v" + t.getVersion() + " - " + t.getTitle()
                + "\n    Created: " + t.getCreatedAt() + (t.isCompleted() ? "\n    Completed: " + t.getCompletedAt() : "")
                + (t.hasDescription() ? "\n    Description: " + t.getDescription() : "");
    }
}
