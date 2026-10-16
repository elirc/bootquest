// BqMain.java — the graded launcher. Learners never need it; graders do.
//
//     java -Dbq.nonce.file=<path> -Dbq.result.file=<path> \
//          -cp <lib-out><sep><exercise-classes> bootcamp.BqMain Exercise [args…]
//
// Protocol (FORMAT.md, "The grading channel"):
//   1. read the nonce from -Dbq.nonce.file and DELETE that file — before the
//      exercise class is loaded, so code under test can never read it;
//   2. load and initialise the exercise class (its static initialisers run
//      now, and anything they register with Check is discarded);
//   3. arm Check with the nonce and -Dbq.result.file, then invoke main.
// The exercise's own `System.exit(report())` ends the run; report() writes
//     #bq-result <nonce> <base64 json {passed,failed,todo,tests:[…]}>
// to the result file. No result file means a crash — never a pass.
//
// Exit codes of BqMain itself (only when it fails before main runs):
//   2 = usage, 3 = nonce file unreadable or not deletable, 4 = class/main
//   missing. An uncaught exception out of main exits 1 (no result written
//   unless report() already ran).
//
// Without -Dbq.nonce.file, BqMain just runs main (no result file) — handy
// for running a compiled exercise by hand.

package bootcamp;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;

public final class BqMain {
    private BqMain() {}

    public static void main(String[] args) {
        if (args.length < 1) {
            System.err.println("usage: java [-Dbq.nonce.file=F -Dbq.result.file=R] "
                + "-cp <lib>:<classes> bootcamp.BqMain <ExerciseClass> [args…]");
            System.exit(2);
        }

        String nonce = null;
        Path resultFile = null;
        var nonceProp = System.getProperty("bq.nonce.file");
        if (nonceProp != null && !nonceProp.isEmpty()) {
            var nonceFile = Path.of(nonceProp);
            try {
                nonce = Files.readString(nonceFile, StandardCharsets.UTF_8).trim();
                Files.delete(nonceFile);
            } catch (Exception e) {
                System.err.println("bootcamp: nonce file unreadable or not deletable: " + e);
                System.exit(3);
            }
            if (nonce.isEmpty() || !nonce.matches("[A-Za-z0-9_-]+")) {
                System.err.println("bootcamp: nonce file is empty or malformed");
                System.exit(3);
            }
            var resultProp = System.getProperty("bq.result.file");
            if (resultProp == null || resultProp.isEmpty()) {
                System.err.println("bootcamp: -Dbq.nonce.file given without -Dbq.result.file");
                System.exit(2);
            }
            resultFile = Path.of(resultProp);
        }

        // Touch Check first so stdout is UTF-8 before any exercise code runs.
        Check.isTodo(null);

        Method main;
        try {
            var cls = Class.forName(args[0], true, ClassLoader.getSystemClassLoader());
            main = cls.getDeclaredMethod("main", String[].class);
            if (!Modifier.isStatic(main.getModifiers())) throw new NoSuchMethodException("main is not static");
            main.setAccessible(true);
        } catch (ClassNotFoundException | NoSuchMethodException e) {
            System.err.println("bootcamp: cannot launch " + args[0] + ": " + e);
            System.exit(4);
            return;
        } catch (ExceptionInInitializerError e) {
            System.err.println("bootcamp: " + args[0] + " failed during class initialisation:");
            e.getCause().printStackTrace();
            System.exit(1);
            return;
        }

        if (nonce != null) Check.arm(nonce, resultFile);

        try {
            main.invoke(null, (Object) Arrays.copyOfRange(args, 1, args.length));
        } catch (InvocationTargetException e) {
            e.getCause().printStackTrace();
            System.exit(1);
        } catch (IllegalAccessException e) {
            System.err.println("bootcamp: cannot invoke main: " + e);
            System.exit(4);
        }
    }
}
