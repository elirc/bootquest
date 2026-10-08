package todo.repository;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.LocalDateTime;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import todo.model.Task;
import static java.nio.file.StandardOpenOption.*;

/** Cooperative cross-process locking plus baseline comparison and atomic replacement. */
public class TaskRepository {
    public static final int MAX_BYTES = 8 * 1024 * 1024;
    private static final Map<Path, Object> LOCAL_LOCKS = new ConcurrentHashMap<>();
    private final Path filePath;
    private byte[] baseline;
    private boolean loaded;
    private TaskSnapshot current;
    public TaskRepository(String fileName) { filePath = Path.of(fileName).toAbsolutePath().normalize(); }
    public Path path() { return filePath; }
    private byte[] bytes() throws IOException {
        if (Files.isSymbolicLink(filePath)) throw new IOException("Symbolic-link data files are unsupported.");
        if (!Files.exists(filePath)) return null;
        if (!Files.isRegularFile(filePath) || Files.size(filePath) > MAX_BYTES) throw new IOException("Invalid data file or file exceeds 8 MiB.");
        byte[] value;
        try (var input = Files.newInputStream(filePath)) { value = input.readNBytes(MAX_BYTES + 1); }
        if (value.length > MAX_BYTES) throw new IOException("File exceeds 8 MiB.");
        return value;
    }
    public synchronized TaskSnapshot load() throws IOException {
        byte[] read = bytes();
        TaskSnapshot parsed = read == null ? TaskSnapshot.empty() : decode(read);
        baseline = read; current = parsed; loaded = true; return parsed;
    }
    public synchronized void save(TaskSnapshot candidate) throws IOException {
        if (!loaded) throw new IOException("Load the repository before saving.");
        if (current.revision() == Long.MAX_VALUE || candidate.revision() != current.revision() + 1)
            throw new IOException("Snapshot revision must advance exactly once.");
        if (candidate.nextId() < current.nextId()) throw new IOException("Next-id watermark cannot move backward.");
        byte[] encoded = encode(candidate);
        Files.createDirectories(filePath.getParent());
        Path lockPath = filePath.resolveSibling(filePath.getFileName() + ".lock");
        synchronized (LOCAL_LOCKS.computeIfAbsent(lockPath, ignored -> new Object())) {
            if (Files.isSymbolicLink(lockPath)) throw new IOException("Symbolic-link locks are unsupported.");
            try (FileChannel channel = FileChannel.open(lockPath, CREATE, WRITE); var lock = channel.lock()) {
                if (!Arrays.equals(baseline, bytes())) throw new IOException("File changed in another session. Reload before retrying; no data was overwritten.");
                if (baseline != null && !decodeUtf8(baseline).startsWith("TODOLIST1\n")) {
                    Path backup = filePath.resolveSibling(filePath.getFileName() + ".legacy-backup");
                    try { Files.write(backup, baseline, CREATE_NEW, WRITE); }
                    catch (FileAlreadyExistsException e) {
                        if (Files.isSymbolicLink(backup) || Files.size(backup) != baseline.length || !Arrays.equals(Files.readAllBytes(backup), baseline))
                            throw new IOException("A different legacy backup exists; keep it and choose a new destination.");
                    }
                }
                Path temporary = Files.createTempFile(filePath.getParent(), ".todo-save-", ".tmp");
                try {
                    try (FileChannel output = FileChannel.open(temporary, WRITE, TRUNCATE_EXISTING)) {
                        ByteBuffer buffer = ByteBuffer.wrap(encoded); while (buffer.hasRemaining()) output.write(buffer); output.force(true);
                    }
                    replaceAtomically(temporary, filePath);
                    baseline = encoded; current = candidate;
                } finally { Files.deleteIfExists(temporary); }
            }
        }
    }
    /** Override only in tests to inject a failure before the commit boundary. */
    protected void replaceAtomically(Path source, Path target) throws IOException {
        Files.move(source, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
    }
    private static String decodeUtf8(byte[] value) throws IOException {
        return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(value)).toString();
    }
    private static String b64(String value) { return Base64.getEncoder().encodeToString(value.getBytes(StandardCharsets.UTF_8)); }
    private static String un64(String value) throws IOException {
        byte[] raw = Base64.getDecoder().decode(value);
        if (!Base64.getEncoder().encodeToString(raw).equals(value)) throw new IOException("Non-canonical Base64.");
        return decodeUtf8(raw);
    }
    public static byte[] encode(TaskSnapshot snapshot) throws IOException {
        StringBuilder out = new StringBuilder("TODOLIST1\n").append(snapshot.revision()).append('\t').append(snapshot.nextId()).append('\n');
        for (Task t : snapshot.tasks()) out.append(t.getId()).append('\t').append(t.getVersion()).append('\t')
                .append(b64(t.getTitle())).append('\t').append(b64(t.getDescription())).append('\t')
                .append(t.isCompleted()).append('\t').append(t.getCreatedAt()).append('\t')
                .append(t.getCompletedAt() == null ? "" : t.getCompletedAt()).append('\n');
        out.append("END\t").append(snapshot.tasks().size()).append('\n');
        byte[] bytes = out.toString().getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MAX_BYTES) throw new IOException("Snapshot exceeds 8 MiB.");
        return bytes;
    }
    private static long number(String value) {
        if (!value.matches("0|[1-9][0-9]*")) throw new IllegalArgumentException("Invalid integer.");
        return Long.parseLong(value);
    }
    private static boolean bool(String value) {
        if (!value.equals("true") && !value.equals("false")) throw new IllegalArgumentException("Invalid boolean.");
        return value.equals("true");
    }
    public static TaskSnapshot decode(byte[] bytes) throws IOException {
        if (bytes.length > MAX_BYTES) throw new IOException("File exceeds 8 MiB.");
        try {
            String text = decodeUtf8(bytes);
            if (!text.startsWith("TODOLIST1\n")) return legacy(text);
            String[] lines = text.split("\n", -1);
            if (lines.length < 4 || !lines[lines.length - 1].isEmpty()) throw new IOException("Truncated snapshot.");
            String[] header = lines[1].split("\t", -1); if (header.length != 2) throw new IOException("Invalid snapshot header.");
            var tasks = new ArrayList<Task>();
            for (int i = 2; i < lines.length - 2; i++) {
                String[] f = lines[i].split("\t", -1); if (f.length != 7) throw new IOException("Invalid task row.");
                tasks.add(new Task(Math.toIntExact(number(f[0])), Math.toIntExact(number(f[1])), un64(f[2]), un64(f[3]), bool(f[4]), LocalDateTime.parse(f[5]), f[6].isEmpty() ? null : LocalDateTime.parse(f[6])));
            }
            if (!lines[lines.length - 2].equals("END\t" + tasks.size())) throw new IOException("Snapshot count or trailer is invalid.");
            return new TaskSnapshot(number(header[0]), number(header[1]), tasks);
        } catch (IllegalArgumentException | ArithmeticException | java.time.DateTimeException e) { throw new IOException("Invalid task data: " + e.getMessage(), e); }
    }
    private static TaskSnapshot legacy(String text) throws IOException {
        if (text.isEmpty()) return TaskSnapshot.empty();
        var tasks = new ArrayList<Task>(); var fields = new LinkedHashMap<String, String>();
        Set<String> keys = Set.of("id", "title", "description", "completed", "createdAt", "completedAt");
        for (String line : text.split("\r?\n")) {
            if (line.equals("---")) { if (fields.isEmpty()) throw new IOException("Empty legacy record."); tasks.add(legacyTask(fields, keys)); fields.clear(); }
            else { int split = line.indexOf('='); if (split < 1 || !keys.contains(line.substring(0, split)) || fields.putIfAbsent(line.substring(0, split), line.substring(split + 1)) != null) throw new IOException("Unknown, duplicate or malformed legacy field."); }
        }
        if (!fields.isEmpty()) throw new IOException("Legacy record is missing its closing separator.");
        long next = tasks.stream().mapToLong(Task::getId).max().orElse(0) + 1;
        return new TaskSnapshot(0, next, tasks);
    }
    private static Task legacyTask(Map<String, String> f, Set<String> keys) throws IOException {
        if (!f.keySet().equals(keys)) throw new IOException("Legacy task is missing required fields.");
        return new Task(Math.toIntExact(number(f.get("id"))), f.get("title"), f.get("description"), bool(f.get("completed")), LocalDateTime.parse(f.get("createdAt")), f.get("completedAt").isEmpty() ? null : LocalDateTime.parse(f.get("completedAt")));
    }
}
