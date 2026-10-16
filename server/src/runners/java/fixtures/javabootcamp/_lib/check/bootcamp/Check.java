// Check.java — the bootcamp's tiny test harness. Zero dependencies, JDK only.
//
// Build it once (from the repo root), then run any exercise file directly:
//
//     javac --release 17 -encoding UTF-8 -d bootcamp/_lib/out bootcamp/_lib/check/bootcamp/*.java
//     java -cp ../../_lib/out 01-count-vowels.java
//
// API (bring it in with `import static bootcamp.Check.*;`):
//   test(name, body)               register + run a test (a ThrowingRunnable)
//   eq(actual, expected[, msg])    deep structural equality (see deepEquals)
//   ok(value[, msg])               assert true
//   raises(Type.class, body[, s])  body must throw Type (message substring opt.)
//   approx(actual, exp[, eps])     floating-point comparison (default 1e-9)
//   report()                       print the summary, return the exit code
//
// A test whose code throws UnsupportedOperationException("TODO") — that is
// what every starter stub throws — is reported as "todo", not as a failure.
// That is the "you haven't written it yet" state, and it keeps an untouched
// exercise green-ish rather than shouting at you.
//
// Grading channel: when the file is launched through bootcamp.BqMain with a
// nonce (see BqMain.java and FORMAT.md), report() ALSO writes one line,
//     #bq-result <nonce> <base64(json)>
// to the file named by -Dbq.result.file. The `#done` line on stdout is for
// humans and for verify; the grader trusts only the result file.

package bootcamp;

import java.io.FileDescriptor;
import java.io.FileOutputStream;
import java.io.PrintStream;
import java.lang.reflect.Array;
import java.lang.reflect.RecordComponent;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collection;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

public final class Check {
    private Check() {}

    /** A test body. May throw anything; checked exceptions need no wrapping. */
    @FunctionalInterface
    public interface ThrowingRunnable {
        void run() throws Throwable;
    }

    private enum Outcome { PASS, FAIL, TODO }

    private record Result(Outcome outcome, String name, String detail) {}

    private static final List<Result> RESULTS = new ArrayList<>();

    /** UTF-8 stdout, whatever the platform default is (Windows consoles!). */
    private static final PrintStream OUT =
        new PrintStream(new FileOutputStream(FileDescriptor.out), true, StandardCharsets.UTF_8);

    static {
        System.out.flush();
        System.setOut(OUT);
    }

    private static final boolean USE_COLOR =
        System.console() != null && System.getenv("NO_COLOR") == null;

    // ── grading channel (set only by BqMain) ──────────────────────────────

    private static String nonce;
    private static Path resultFile;
    private static boolean armed;

    /** Called by BqMain after the exercise class is initialised. */
    static void arm(String theNonce, Path theResultFile) {
        nonce = theNonce;
        resultFile = theResultFile;
        armed = true;
        RESULTS.clear(); // anything registered during class init does not count
    }

    // ── colour ────────────────────────────────────────────────────────────

    private static String c(String code, String s) {
        return USE_COLOR ? "\u001b[" + code + "m" + s + "\u001b[0m" : s;
    }

    private static String green(String s) { return c("32", s); }
    private static String red(String s) { return c("31", s); }
    private static String yellow(String s) { return c("33", s); }
    private static String dim(String s) { return c("2", s); }

    // ── the failure type ──────────────────────────────────────────────────

    /** Thrown by the assertions. Carries the rendered actual/expected values. */
    public static final class CheckFailure extends AssertionError {
        private static final long serialVersionUID = 1L;
        private final String actual;
        private final String expected;

        public CheckFailure(String message) {
            this(message, null, null);
        }

        public CheckFailure(String message, String actual, String expected) {
            super(message);
            this.actual = actual;
            this.expected = expected;
        }

        public String actual() { return actual; }
        public String expected() { return expected; }
    }

    // ── running a test ────────────────────────────────────────────────────

    public static void test(String name, ThrowingRunnable body) {
        try {
            body.run();
            record(Outcome.PASS, name, null);
        } catch (Throwable ex) {
            recordThrow(name, ex);
        }
    }

    private static void recordThrow(String name, Throwable ex) {
        if (isTodo(ex)) {
            record(Outcome.TODO, name, null);
            return;
        }
        if (ex instanceof CheckFailure failure) {
            var detail = new StringBuilder(String.valueOf(failure.getMessage()));
            if (failure.expected() != null || failure.actual() != null) {
                detail.append('\n').append(dim("      expected: "))
                      .append(failure.expected() == null ? "-" : failure.expected());
                detail.append('\n').append(dim("      received: "))
                      .append(failure.actual() == null ? "-" : failure.actual());
            }
            record(Outcome.FAIL, name, detail.toString());
            return;
        }
        var line = firstUserFrame(ex);
        record(Outcome.FAIL, name, ex.getClass().getSimpleName() + ": " + ex.getMessage()
            + (line == null ? "" : "\n" + dim("      at " + line)));
    }

    /**
     * The starter-stub signal: UnsupportedOperationException whose message
     * starts with "TODO", anywhere in the cause chain (so a stub called from
     * inside a stream or wrapped by learner code still counts as todo).
     * A bare UnsupportedOperationException — List.of(..).add(..) — is a
     * real failure.
     */
    static boolean isTodo(Throwable ex) {
        for (int depth = 0; ex != null && depth < 8; depth++, ex = ex.getCause()) {
            if (ex instanceof UnsupportedOperationException
                    && ex.getMessage() != null && ex.getMessage().startsWith("TODO")) {
                return true;
            }
        }
        return false;
    }

    private static String firstUserFrame(Throwable ex) {
        for (var frame : ex.getStackTrace()) {
            var cls = frame.getClassName();
            if (cls.startsWith("bootcamp.") || cls.startsWith("java.") || cls.startsWith("jdk.")
                    || cls.startsWith("sun.")) {
                continue;
            }
            return frame.toString();
        }
        return null;
    }

    private static void record(Outcome outcome, String name, String detail) {
        RESULTS.add(new Result(outcome, name, detail));
        switch (outcome) {
            case PASS -> OUT.println("  " + green("✔") + " " + name);
            case TODO -> OUT.println("  " + yellow("☐") + " " + name + " " + dim("todo"));
            default -> {
                OUT.println("  " + red("✘") + " " + name);
                if (detail != null) OUT.println("      " + detail);
            }
        }
    }

    // ── the summary ───────────────────────────────────────────────────────

    /**
     * Print the summary and return the exit code (1 if anything failed).
     * Use it as {@code System.exit(report());} — the last line of main.
     */
    public static int report() {
        int passed = 0, failed = 0, todo = 0;
        for (var r : RESULTS) {
            switch (r.outcome()) {
                case PASS -> passed++;
                case FAIL -> failed++;
                case TODO -> todo++;
            }
        }

        var parts = new ArrayList<String>();
        parts.add(passed + " passed");
        if (failed > 0) parts.add(red(failed + " failed"));
        if (todo > 0) parts.add(yellow(todo + " todo"));

        OUT.println();
        OUT.println("  " + String.join(" · ", parts));
        if (failed == 0 && todo == 0 && passed > 0) {
            OUT.println("  " + green("all green — next file!"));
        }

        // The machine-readable line the tools parse. Keep the format stable.
        OUT.println("  #done passed=" + passed + " failed=" + failed + " todo=" + todo);
        OUT.flush();

        if (armed && resultFile != null) writeResult(passed, failed, todo);
        return failed > 0 ? 1 : 0;
    }

    private static void writeResult(int passed, int failed, int todo) {
        var json = new StringBuilder();
        json.append("{\"passed\":").append(passed)
            .append(",\"failed\":").append(failed)
            .append(",\"todo\":").append(todo)
            .append(",\"tests\":[");
        for (int i = 0; i < RESULTS.size(); i++) {
            var r = RESULTS.get(i);
            if (i > 0) json.append(',');
            json.append("{\"name\":").append(jsonString(r.name()))
                .append(",\"status\":").append(jsonString(r.outcome().name().toLowerCase()));
            if (r.detail() != null) {
                json.append(",\"detail\":").append(jsonString(stripAnsi(r.detail())));
            }
            json.append('}');
        }
        json.append("]}");
        var payload = Base64.getEncoder()
            .encodeToString(json.toString().getBytes(StandardCharsets.UTF_8));
        var line = "#bq-result " + nonce + " " + payload + "\n";
        try {
            Files.writeString(resultFile, line, StandardCharsets.UTF_8);
        } catch (Exception e) {
            System.err.println("bootcamp: could not write the result file: " + e);
        }
    }

    private static String stripAnsi(String s) {
        return s.replaceAll("\u001b\\[[0-9;]*m", "");
    }

    private static String jsonString(String s) {
        var b = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char ch = s.charAt(i);
            switch (ch) {
                case '"' -> b.append("\\\"");
                case '\\' -> b.append("\\\\");
                case '\n' -> b.append("\\n");
                case '\r' -> b.append("\\r");
                case '\t' -> b.append("\\t");
                default -> {
                    if (ch < 0x20) b.append(String.format("\\u%04x", (int) ch));
                    else b.append(ch);
                }
            }
        }
        return b.append('"').toString();
    }

    // ── assertions ────────────────────────────────────────────────────────

    public static void eq(Object actual, Object expected) {
        eq(actual, expected, "values differ");
    }

    public static void eq(Object actual, Object expected, String message) {
        if (!deepEquals(actual, expected)) {
            throw new CheckFailure(message, show(actual), show(expected));
        }
    }

    public static void ok(boolean value) {
        ok(value, "expected true");
    }

    public static void ok(boolean value, String message) {
        if (!value) throw new CheckFailure(message);
    }

    public static void approx(double actual, double expected) {
        approx(actual, expected, 1e-9);
    }

    public static void approx(double actual, double expected, double eps) {
        if (Double.isNaN(actual) || Math.abs(actual - expected) > eps) {
            throw new CheckFailure("numbers differ", show(actual), show(expected));
        }
    }

    public static <T extends Throwable> T raises(Class<T> type, ThrowingRunnable body) {
        return raises(type, body, null);
    }

    /** body must throw {@code type} (or a subclass); returns it for more checks. */
    public static <T extends Throwable> T raises(Class<T> type, ThrowingRunnable body,
                                                 String messageContains) {
        try {
            body.run();
        } catch (Throwable ex) {
            if (isTodo(ex)) throw sneaky(ex); // unimplemented code isn't a real throw
            if (!type.isInstance(ex)) {
                throw new CheckFailure("threw, but the wrong exception type",
                    ex.getClass().getSimpleName() + ": " + ex.getMessage(), type.getSimpleName());
            }
            if (messageContains != null && (ex.getMessage() == null
                    || !ex.getMessage().toLowerCase().contains(messageContains.toLowerCase()))) {
                throw new CheckFailure("threw, but the message was wrong",
                    show(ex.getMessage()), show(messageContains));
            }
            return type.cast(ex);
        }
        throw new CheckFailure("expected a " + type.getSimpleName() + " but nothing was thrown");
    }

    @SuppressWarnings("unchecked")
    private static <E extends Throwable> RuntimeException sneaky(Throwable t) throws E {
        throw (E) t;
    }

    // ── deep equality ─────────────────────────────────────────────────────
    //
    // equals() is the right first question for most values, but not all:
    //  * arrays compare by reference, which is never what a test means, so
    //    sequences (arrays, Lists, any ordered Collection) compare element by
    //    element — and an int[] equals a List<Integer> with the same items;
    //  * Sets compare as sets, Maps as maps (key order never matters);
    //  * records compare component by component, recursively, so a record
    //    holding an array or a BigDecimal still compares by value;
    //  * BigDecimal compares by compareTo: 2.50 equals 2.5. A test that cares
    //    about the SCALE says so explicitly (eq(x.scale(), 2));
    //  * whole numbers compare by value across Byte/Short/Integer/Long/
    //    BigInteger, so eq(someLong, 3) works; doubles compare like
    //    Double.equals (NaN equals NaN) and never equal an integer — use
    //    approx() for computed floating-point values.

    public static boolean deepEquals(Object a, Object b) {
        if (a == b) return true;
        if (a == null || b == null) return false;

        if (a instanceof BigDecimal da && b instanceof BigDecimal db) return da.compareTo(db) == 0;
        if (isWhole(a) && isWhole(b)) return toBig(a).equals(toBig(b));
        if (a instanceof Double || a instanceof Float || b instanceof Double || b instanceof Float) {
            if ((a instanceof Double || a instanceof Float) && (b instanceof Double || b instanceof Float)) {
                return Double.compare(((Number) a).doubleValue(), ((Number) b).doubleValue()) == 0;
            }
            return false;
        }

        if (a instanceof Map<?, ?> ma && b instanceof Map<?, ?> mb) {
            if (ma.size() != mb.size()) return false;
            for (var e : ma.entrySet()) {
                if (!mb.containsKey(e.getKey())) return false;
                if (!deepEquals(e.getValue(), mb.get(e.getKey()))) return false;
            }
            return true;
        }

        if (a instanceof Set<?> sa && b instanceof Set<?> sb) {
            if (sa.size() != sb.size()) return false;
            var unmatched = new ArrayList<Object>(sb);
            outer:
            for (var x : sa) {
                for (var it = unmatched.iterator(); it.hasNext(); ) {
                    if (deepEquals(x, it.next())) {
                        it.remove();
                        continue outer;
                    }
                }
                return false;
            }
            return true;
        }

        if (isSequence(a) && isSequence(b)) {
            var ia = iterate(a);
            var ib = iterate(b);
            while (true) {
                boolean moreA = ia.hasNext(), moreB = ib.hasNext();
                if (moreA != moreB) return false;
                if (!moreA) return true;
                if (!deepEquals(ia.next(), ib.next())) return false;
            }
        }

        if (a instanceof Optional<?> oa && b instanceof Optional<?> ob) {
            if (oa.isPresent() != ob.isPresent()) return false;
            return oa.isEmpty() || deepEquals(oa.get(), ob.get());
        }

        if (a.getClass().isRecord() && a.getClass() == b.getClass()) {
            for (RecordComponent rc : a.getClass().getRecordComponents()) {
                try {
                    var m = rc.getAccessor();
                    m.setAccessible(true);
                    if (!deepEquals(m.invoke(a), m.invoke(b))) return false;
                } catch (ReflectiveOperationException | RuntimeException e) {
                    return a.equals(b);
                }
            }
            return true;
        }

        return a.equals(b);
    }

    private static boolean isWhole(Object o) {
        return o instanceof Integer || o instanceof Long || o instanceof Short
            || o instanceof Byte || o instanceof BigInteger;
    }

    private static BigInteger toBig(Object o) {
        return o instanceof BigInteger bi ? bi : BigInteger.valueOf(((Number) o).longValue());
    }

    private static boolean isSequence(Object o) {
        return o.getClass().isArray() || (o instanceof Collection<?> && !(o instanceof Set<?>));
    }

    private static Iterator<?> iterate(Object o) {
        if (o instanceof Collection<?> c) return c.iterator();
        int n = Array.getLength(o);
        var items = new ArrayList<Object>(n);
        for (int i = 0; i < n; i++) items.add(Array.get(o, i));
        return items.iterator();
    }

    // ── rendering values in a failure message ─────────────────────────────

    public static String show(Object value) {
        return show(value, 0);
    }

    private static String show(Object value, int depth) {
        if (value == null) return "null";
        if (value instanceof String s) return "\"" + s + "\"";
        if (value instanceof Character ch) return "'" + ch + "'";
        if (value instanceof BigDecimal bd) return bd.toPlainString();
        if (value instanceof Long l) return l + "L";
        if (value instanceof Float f) return f + "f";
        if (value instanceof Optional<?> o) {
            return o.isEmpty() ? "Optional.empty" : "Optional[" + show(o.get(), depth + 1) + "]";
        }
        if (value instanceof Map<?, ?> map) {
            if (depth > 4) return "{ … }";
            var entries = new ArrayList<String>();
            for (var e : map.entrySet()) {
                if (entries.size() == 12) { entries.add("…"); break; }
                entries.add(show(e.getKey(), depth + 1) + ": " + show(e.getValue(), depth + 1));
            }
            return "{" + String.join(", ", entries) + "}";
        }
        if (value instanceof Collection<?> || value.getClass().isArray()) {
            if (depth > 4) return "[ … ]";
            var items = new ArrayList<String>();
            var it = iterate(value);
            while (it.hasNext()) {
                if (items.size() == 12) { items.add("…"); break; }
                items.add(show(it.next(), depth + 1));
            }
            return "[" + String.join(", ", items) + "]";
        }
        if (value.getClass().isRecord()) {
            if (depth > 4) return value.getClass().getSimpleName() + "[…]";
            var parts = new ArrayList<String>();
            for (RecordComponent rc : value.getClass().getRecordComponents()) {
                try {
                    var m = rc.getAccessor();
                    m.setAccessible(true);
                    parts.add(rc.getName() + "=" + show(m.invoke(value), depth + 1));
                } catch (ReflectiveOperationException | RuntimeException e) {
                    return String.valueOf(value);
                }
            }
            return value.getClass().getSimpleName() + "[" + String.join(", ", parts) + "]";
        }
        return String.valueOf(value);
    }
}
