package todo;

import java.io.IOException;
import java.util.NoSuchElementException;
import java.util.Scanner;
import todo.model.Task;
import todo.repository.TaskRepository;
import todo.service.TaskManager;

public final class App {
    private final Scanner scanner = new Scanner(System.in);
    private final TaskManager manager;
    public App(TaskRepository repository) throws IOException { manager = new TaskManager(repository); }
    public static void main(String[] args) {
        if (args.length > 1) { System.err.println("Usage: java -cp out todo.App [tasks-file]"); System.exit(2); }
        try { new App(new TaskRepository(args.length == 1 ? args[0] : "tasks.txt")).run(); }
        catch (IOException | IllegalArgumentException e) { System.err.println("Startup stopped; existing data was not replaced. " + e.getMessage()); System.exit(1); }
    }
    public void run() {
        System.out.println("Loaded " + manager.getAllTasks().size() + " task(s). Every accepted change is saved immediately.");
        try {
            while (true) {
                System.out.println("\n1 Add | 2 List | 3 Complete | 4 Delete | 5 Exit | 6 Edit | 7 Reopen | 8 Search | 9 Reload");
                System.out.print("Choose: "); if (!scanner.hasNextLine()) break; String choice = scanner.nextLine().strip();
                if (choice.equals("5")) break;
                try {
                    switch (choice) {
                        case "1" -> { Task t = manager.addTask(line("Title: "), line("Description (optional): ")); System.out.println("Task " + t.getId() + " added and saved."); }
                        case "2" -> list("", "all");
                        case "3", "7" -> { Task t = selected(); manager.setCompleted(t.getId(), t.getVersion(), choice.equals("3")); System.out.println("Task state accepted."); }
                        case "4" -> { Task t = selected(); if (line("Delete task " + t.getId() + " permanently? Type DELETE: ").equals("DELETE")) { manager.deleteTask(t.getId(), t.getVersion()); System.out.println("Task deleted and saved."); } else System.out.println("Deletion cancelled."); }
                        case "6" -> { Task t = selected(); System.out.println(manager.formatTaskForDisplay(t)); manager.editTask(t.getId(), t.getVersion(), line("New title: "), line("New description (blank clears): ")); System.out.println("Task edited and saved."); }
                        case "8" -> list(line("Search text: "), line("Status (all/open/done): "));
                        case "9" -> { manager.reload(); System.out.println("Current file loaded. Review it before repeating a rejected change."); }
                        default -> System.out.println("Choose 1 through 9.");
                    }
                } catch (IOException | IllegalArgumentException | IllegalStateException e) { System.out.println("Change not accepted: " + e.getMessage()); }
            }
        } catch (NoSuchElementException e) { System.out.println("Input ended; incomplete command was not applied."); }
        finally { scanner.close(); System.out.println("Goodbye. Previously accepted changes remain saved."); }
    }
    private String line(String prompt) { System.out.print(prompt); if (!scanner.hasNextLine()) throw new NoSuchElementException(); return scanner.nextLine().strip(); }
    private Task selected() { String raw = line("Task id: "); if (!raw.matches("[1-9][0-9]*")) throw new IllegalArgumentException("Enter a positive task id."); return manager.findTaskById(Integer.parseInt(raw)); }
    private void list(String query, String status) { var tasks = manager.search(query, status); if (tasks.isEmpty()) System.out.println("No matching tasks."); for (Task t : tasks) System.out.println(manager.formatTaskForDisplay(t)); }
}
