package todo;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import todo.model.Task;
import todo.repository.*;
import todo.service.TaskManager;

public final class TaskWorkflowTest {
    private static int passed;
    private static Path root;
    private static final LocalDateTime AT = LocalDateTime.of(2026, 9, 9, 12, 0);
    private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-09-09T13:00:00Z"), ZoneOffset.UTC);
    @FunctionalInterface interface Checked { void run() throws Exception; }
    static void check(boolean condition) { if (!condition) throw new AssertionError("Assertion failed"); }
    static void rejects(Class<? extends Throwable> type, Checked work) throws Exception {
        try { work.run(); } catch (Throwable e) { if (type.isInstance(e)) return; throw new AssertionError("Expected " + type + " but got " + e, e); }
        throw new AssertionError("Expected rejection: " + type);
    }
    static void test(String name, Checked work) throws Exception { work.run(); passed++; System.out.println("PASS " + name); }
    static Path file() { return root.resolve(UUID.randomUUID() + ".txt"); }
    static Task task() { return new Task(1, "Study transactions", "Use a disposable fixture", false, AT, null); }
    static TaskManager manager(Path p) throws IOException { return new TaskManager(new TaskRepository(p.toString()), CLOCK); }
    static byte[] legacy(String extra) { return ("id=1\ntitle=Legacy task\ndescription=Keep this text\ncompleted=false\ncreatedAt=2026-09-09T12:00\ncompletedAt=\n" + extra + "---\n").getBytes(StandardCharsets.UTF_8); }
    public static void main(String[] args) throws Exception {
        if (args.length > 0 && args[0].equals("worker")) {
            TaskManager manager = manager(Path.of(args[1])); Files.writeString(Path.of(args[2]), "ready");
            long deadline = System.nanoTime() + 15_000_000_000L;
            while (!Files.exists(Path.of(args[3]))) { if (System.nanoTime() > deadline) throw new IOException("Barrier timeout"); Thread.sleep(10); }
            try { manager.addTask(args[4], "Cross-process attempt"); System.out.println("ACCEPTED"); }
            catch (IOException e) { System.out.println("CONFLICT"); }
            return;
        }
        root = Path.of(args[0]); Files.createDirectories(root);
        test("model trims and validates text", () -> { Task t = new Task(1,"  Title  ","  Detail  ",false,AT,null); check(t.getTitle().equals("Title")); rejects(IllegalArgumentException.class,()->new Task(1," ","",false,AT,null)); });
        test("control characters cannot enter task fields", () -> rejects(IllegalArgumentException.class,()->new Task(1,"A\nB","",false,AT,null)));
        test("positive identity and version required", () -> { rejects(IllegalArgumentException.class,()->new Task(0,"Task","",false,AT,null)); rejects(IllegalArgumentException.class,()->new Task(1,0,"Task","",false,AT,null)); });
        test("completion timestamp matches state", () -> { rejects(IllegalArgumentException.class,()->new Task(1,"Task","",true,AT,null)); rejects(IllegalArgumentException.class,()->new Task(1,"Task","",false,AT,AT)); rejects(IllegalArgumentException.class,()->new Task(1,"Task","",true,AT,AT.minusMinutes(1))); });
        test("edits return immutable versions", () -> { Task old = task(), next = old.edit("Updated title",""); check(old.getVersion()==1&&next.getVersion()==2&&old.getTitle().equals("Study transactions")); });
        test("complete and reopen preserve creation time", () -> { Task old=task(),done=old.withCompletion(true,AT.plusHours(1)),open=done.withCompletion(false,AT.plusHours(2)); check(done.isCompleted()&&!open.isCompleted()&&open.getCompletedAt()==null&&open.getCreatedAt().equals(AT)&&open.getVersion()==3); });
        test("same desired completion returns same immutable value", () -> check(task().withCompletion(false,AT).getVersion()==1));
        test("version exhaustion rejects without wraparound", () -> rejects(IllegalStateException.class,()->new Task(1,Integer.MAX_VALUE,"Task","",false,AT,null).edit("Another","")));
        test("missing file loads without creating data", () -> { Path p=file(); check(manager(p).getAllTasks().isEmpty()); check(!Files.exists(p)); });
        test("snapshot roundtrip preserves delimiters and Unicode", () -> { Task t=new Task(1,"Text = | \u65e5\u672c","Delimiter --- remains text",false,AT,null); TaskSnapshot s=new TaskSnapshot(7,9,List.of(t)); TaskSnapshot read=TaskRepository.decode(TaskRepository.encode(s)); check(read.revision()==7&&read.nextId()==9&&read.tasks().get(0).getTitle().equals(t.getTitle())); });
        test("snapshot requires unique ids and a higher watermark", () -> { rejects(IllegalArgumentException.class,()->new TaskSnapshot(0,2,List.of(task(),task()))); rejects(IllegalArgumentException.class,()->new TaskSnapshot(0,1,List.of(task()))); });
        test("snapshot truncation is detected", () -> { byte[] raw=TaskRepository.encode(new TaskSnapshot(1,2,List.of(task()))); rejects(IOException.class,()->TaskRepository.decode(Arrays.copyOf(raw,raw.length-1))); });
        test("wrong trailer count is rejected", () -> { String raw=new String(TaskRepository.encode(new TaskSnapshot(1,2,List.of(task()))),StandardCharsets.UTF_8).replace("END\t1","END\t2"); rejects(IOException.class,()->TaskRepository.decode(raw.getBytes(StandardCharsets.UTF_8))); });
        test("malformed UTF8 is rejected", () -> rejects(IOException.class,()->TaskRepository.decode(new byte[]{(byte)0xc3,0x28})));
        test("oversized input is rejected before parsing", () -> rejects(IOException.class,()->TaskRepository.decode(new byte[TaskRepository.MAX_BYTES+1])));
        test("complete legacy record loads", () -> check(TaskRepository.decode(legacy("")).tasks().get(0).getTitle().equals("Legacy task")));
        test("legacy unknown and duplicate keys reject", () -> { rejects(IOException.class,()->TaskRepository.decode(legacy("extra=value\n"))); rejects(IOException.class,()->TaskRepository.decode(legacy("id=2\n"))); });
        test("legacy invalid booleans reject", () -> rejects(IOException.class,()->TaskRepository.decode(new String(legacy(""),StandardCharsets.UTF_8).replace("completed=false","completed=nope").getBytes(StandardCharsets.UTF_8))));
        test("legacy invalid dates become controlled IO failures", () -> rejects(IOException.class,()->TaskRepository.decode(new String(legacy(""),StandardCharsets.UTF_8).replace("2026-09-09T12:00","bad-date").getBytes(StandardCharsets.UTF_8))));
        test("legacy missing separator rejects", () -> rejects(IOException.class,()->TaskRepository.decode(new String(legacy(""),StandardCharsets.UTF_8).replace("---\n","").getBytes(StandardCharsets.UTF_8))));
        test("legacy duplicate ids reject entire load", () -> rejects(IOException.class,()->TaskRepository.decode((new String(legacy(""),StandardCharsets.UTF_8).repeat(2)).getBytes(StandardCharsets.UTF_8))));
        test("create commits before another manager reads it", () -> { Path p=file(); TaskManager m=manager(p); m.addTask("First task","Description"); check(manager(p).getAllTasks().size()==1&&m.revision()==1); });
        test("edit complete reopen and delete persist", () -> { Path p=file(); TaskManager m=manager(p); Task t=m.addTask("First task",""); t=m.editTask(t.getId(),t.getVersion(),"Edited task","Detail"); t=m.setCompleted(t.getId(),t.getVersion(),true); check(manager(p).findTaskById(t.getId()).isCompleted()); t=m.setCompleted(t.getId(),t.getVersion(),false); m.deleteTask(t.getId(),t.getVersion()); check(manager(p).getAllTasks().isEmpty()); });
        test("deleted highest id is not reused after restart", () -> { Path p=file(); TaskManager m=manager(p); Task t=m.addTask("First task",""); m.deleteTask(t.getId(),t.getVersion()); check(manager(p).addTask("Second task","").getId()==2); });
        test("stale record version rejects without changing accepted data", () -> { Path p=file(); TaskManager m=manager(p); Task t=m.addTask("First task",""); m.editTask(t.getId(),1,"Accepted title",""); rejects(IllegalStateException.class,()->m.editTask(t.getId(),1,"Stale title","")); check(m.findTaskById(t.getId()).getTitle().equals("Accepted title")); });
        test("separate repository sessions conflict and reload recovers", () -> { Path p=file(); TaskManager a=manager(p),b=manager(p); a.addTask("Accepted title",""); rejects(IOException.class,()->b.addTask("Stale title","")); check(b.getAllTasks().isEmpty()); b.reload(); b.addTask("After reload",""); check(manager(p).getAllTasks().size()==2); });
        test("external file edit is not overwritten", () -> { Path p=file(); TaskManager m=manager(p); Files.writeString(p,"external data"); rejects(IOException.class,()->m.addTask("Task title","")); check(Files.readString(p).equals("external data")); });
        test("atomic replacement failure retains memory and disk", () -> { Path p=file(); manager(p).addTask("Existing task",""); byte[] before=Files.readAllBytes(p); TaskRepository failing=new TaskRepository(p.toString()) { protected void replaceAtomically(Path a,Path b)throws IOException{throw new IOException("Injected move failure");} }; TaskManager m=new TaskManager(failing,CLOCK); rejects(IOException.class,()->m.addTask("Rejected task","")); check(m.getAllTasks().size()==1&&Arrays.equals(before,Files.readAllBytes(p))); });
        test("legacy conversion preserves original backup", () -> { Path p=file(); byte[] old=legacy(""); Files.write(p,old); manager(p).addTask("New task",""); check(Arrays.equals(old,Files.readAllBytes(p.resolveSibling(p.getFileName()+".legacy-backup")))); check(manager(p).getAllTasks().size()==2); });
        test("different legacy backup stops conversion", () -> { Path p=file(); byte[] old=legacy(""); Files.write(p,old); Files.writeString(p.resolveSibling(p.getFileName()+".legacy-backup"),"other backup"); TaskManager m=manager(p); rejects(IOException.class,()->m.addTask("New task","")); check(Arrays.equals(old,Files.readAllBytes(p))&&m.getAllTasks().size()==1); });
        test("search is literal case-insensitive and status-aware", () -> { TaskManager m=manager(file()); Task a=m.addTask("Alpha 100%","Details"),b=m.addTask("Beta task","Alpha context"); m.setCompleted(a.getId(),1,true); check(m.search("alpha","all").size()==2&&m.search("%","done").size()==1&&m.search("alpha","open").get(0).getId()==b.getId()); });
        test("returned task list cannot mutate manager state", () -> { TaskManager m=manager(file()); m.addTask("First task",""); rejects(UnsupportedOperationException.class,()->m.getAllTasks().clear()); });
        test("invalid create leaves memory and disk unchanged", () -> { Path p=file(); TaskManager m=manager(p); rejects(IllegalArgumentException.class,()->m.addTask(" ","")); check(!Files.exists(p)&&m.getAllTasks().isEmpty()); });
        test("failed reload retains previous in-memory snapshot", () -> { Path p=file(); TaskManager m=manager(p); m.addTask("Existing task",""); Files.writeString(p,"malformed"); rejects(IOException.class,m::reload); check(m.getAllTasks().size()==1); rejects(IOException.class,()->m.addTask("Rejected task","")); });
        test("watermark cannot move backward through repository", () -> { Path p=file(); TaskRepository r=new TaskRepository(p.toString()); r.load(); r.save(new TaskSnapshot(1,10,List.of())); rejects(IOException.class,()->r.save(new TaskSnapshot(2,1,List.of()))); });
        System.out.println("RESULT {\"passed\":true,\"tests\":" + passed + "}");
    }
}
