// Check.cs — the bootcamp's tiny test harness. No NuGet, no test runner.
//
// Every exercise file references this project and is run directly:
//
//     dotnet run 03-word-count.cs
//
// API:
//   Test(name, fn)             register + run a test (fn may be async)
//   Eq(actual, expected, m?)   deep structural equality
//   Ok(value, m?)              must be true / non-null
//   Throws<TEx>(fn, match?)    fn must throw TEx; match = substring of message
//   ThrowsAsync<TEx>(fn, m?)   async version
//   Approx(actual, exp, eps?)  float comparison (default eps 1e-9)
//   Spy<...>()                 call recorder: .Calls, .CallCount, .Returns
//   Sleep(ms)                  await a real delay
//
// A test whose code throws NotImplementedException is reported as "todo",
// not as a failure — that's the "you haven't written it yet" state, and it is
// exactly what `throw new NotImplementedException();` in the starter means.

using System.Collections;
using System.Globalization;
using System.Reflection;
using System.Runtime.ExceptionServices;

namespace Bootcamp;

public sealed class CheckFailure : Exception
{
    public object? Actual { get; }
    public object? Expected { get; }
    public bool HasDiff { get; }

    public CheckFailure(string message, object? actual = null, object? expected = null,
                        bool hasDiff = false) : base(message)
        => (Actual, Expected, HasDiff) = (actual, expected, hasDiff);
}

public static class Check
{
    // ── colour ────────────────────────────────────────────────────────────
    private static readonly bool UseColor =
        !Console.IsOutputRedirected &&
        Environment.GetEnvironmentVariable("NO_COLOR") is null;

    private const string Esc = "\u001b";
    private static string C(string code, string s)
        => UseColor ? Esc + "[" + code + "m" + s + Esc + "[0m" : s;
    private static string Green(string s) => C("32", s);
    private static string Red(string s) => C("31", s);
    private static string Yellow(string s) => C("33", s);
    private static string Dim(string s) => C("2", s);
    private static string Bold(string s) => C("1", s);

    // ── assertions ────────────────────────────────────────────────────────

    // Deliberately object-based rather than Eq<T>(T, T): exercises constantly
    // compare a List<int> against an int[], or a long against an int literal,
    // and generic inference would reject those before DeepEquals ever ran.
    public static void Eq(object? actual, object? expected, string message = "values differ")
    {
        if (!DeepEquals(actual, expected))
            throw new CheckFailure(message, actual, expected, true);
    }

    public static void Ok(bool value, string message = "expected true")
    {
        if (!value) throw new CheckFailure(message + " (got false)");
    }

    public static void NotNull(object? value, string message = "expected a non-null value")
    {
        if (value is null) throw new CheckFailure(message + " (got null)");
    }

    public static TEx Throws<TEx>(Action fn, string? match = null,
                                  string message = "expected the code to throw")
        where TEx : Exception
    {
        try
        {
            fn();
        }
        catch (NotImplementedException) { throw; }   // not written yet isn't a real throw
        catch (Exception e)
        {
            return MatchError<TEx>(e, match);
        }
        throw new CheckFailure(message);
    }

    public static Exception Throws(Action fn, string? match = null,
                                   string message = "expected the code to throw")
        => Throws<Exception>(fn, match, message);

    public static async Task<TEx> ThrowsAsync<TEx>(Func<Task> fn, string? match = null,
                                                   string message = "expected the code to throw")
        where TEx : Exception
    {
        try
        {
            await fn();
        }
        catch (NotImplementedException) { throw; }
        catch (Exception e)
        {
            return MatchError<TEx>(e, match);
        }
        throw new CheckFailure(message);
    }

    public static Task<Exception> ThrowsAsync(Func<Task> fn, string? match = null,
                                              string message = "expected the code to throw")
        => ThrowsAsync<Exception>(fn, match, message);

    private static TEx MatchError<TEx>(Exception e, string? match) where TEx : Exception
    {
        if (e is not TEx typed)
            throw new CheckFailure("threw, but the wrong exception type",
                                   e.GetType().Name, typeof(TEx).Name, true);
        if (match is not null && !typed.Message.Contains(match, StringComparison.Ordinal))
            throw new CheckFailure("threw, but the message was wrong",
                                   typed.Message, match, true);
        return typed;
    }

    public static void Approx(double actual, double expected, double eps = 1e-9,
                              string message = "numbers differ")
    {
        if (double.IsNaN(actual) || Math.Abs(actual - expected) > eps)
            throw new CheckFailure(message, actual, expected, true);
    }

    public static Task Sleep(int ms) => Task.Delay(ms);

    // ── deep equality ─────────────────────────────────────────────────────
    //
    // Records and value types already have structural equality, so we lean on
    // Equals first. Sequences and dictionaries get compared element by element
    // so that Eq(list, new[] { 1, 2, 3 }) does what you would expect.

    public static bool DeepEquals(object? a, object? b)
    {
        if (ReferenceEquals(a, b)) return true;
        if (a is null || b is null) return false;

        if (a is string sa && b is string sb) return sa == sb;

        if (IsNumeric(a) && IsNumeric(b))
            return Convert.ToDecimal(a, CultureInfo.InvariantCulture)
                == Convert.ToDecimal(b, CultureInfo.InvariantCulture);

        if (a is IDictionary da && b is IDictionary db)
        {
            if (da.Count != db.Count) return false;
            foreach (DictionaryEntry entry in da)
            {
                if (!db.Contains(entry.Key)) return false;
                if (!DeepEquals(entry.Value, db[entry.Key])) return false;
            }
            return true;
        }

        if (a is IEnumerable ea && b is IEnumerable eb)
        {
            var ia = ea.GetEnumerator();
            var ib = eb.GetEnumerator();
            try
            {
                while (true)
                {
                    var na = ia.MoveNext();
                    var nb = ib.MoveNext();
                    if (na != nb) return false;
                    if (!na) return true;
                    if (!DeepEquals(ia.Current, ib.Current)) return false;
                }
            }
            finally
            {
                (ia as IDisposable)?.Dispose();
                (ib as IDisposable)?.Dispose();
            }
        }

        if (a.Equals(b)) return true;

        // Anonymous types and plain classes: compare public readable properties.
        var ta = a.GetType();
        var tb = b.GetType();
        if (ta != tb) return false;
        if (ta.IsPrimitive || ta.IsEnum) return false;   // Equals already said no

        var props = ta.GetProperties(BindingFlags.Public | BindingFlags.Instance)
                      .Where(p => p.CanRead && p.GetIndexParameters().Length == 0)
                      .ToArray();
        if (props.Length == 0) return false;
        return props.All(p => DeepEquals(p.GetValue(a), p.GetValue(b)));
    }

    private static bool IsNumeric(object o) => o
        is byte or sbyte or short or ushort or int or uint
        or long or ulong or float or double or decimal;

    // ── rendering values for the diff ─────────────────────────────────────

    public static string Show(object? v, int depth = 0)
    {
        switch (v)
        {
            case null: return "null";
            case string s: return "\"" + s + "\"";
            case bool b: return b ? "true" : "false";
            case char c: return "'" + c + "'";
            case double d: return d.ToString("R", CultureInfo.InvariantCulture);
            case float f: return f.ToString("R", CultureInfo.InvariantCulture);
        }

        if (depth > 4) return "…";

        if (v is IDictionary dict)
        {
            var pairs = new List<string>();
            foreach (DictionaryEntry e in dict)
                pairs.Add(Show(e.Key, depth + 1) + ": " + Show(e.Value, depth + 1));
            return "{ " + string.Join(", ", Truncate(pairs)) + " }";
        }

        if (v is IEnumerable seq)
        {
            var items = new List<string>();
            foreach (var item in seq) items.Add(Show(item, depth + 1));
            return "[" + string.Join(", ", Truncate(items)) + "]";
        }

        var t = v.GetType();
        if (t.IsPrimitive || t.IsEnum || v is decimal) return v.ToString() ?? "";

        // records and DTOs already print as Name { A = 1, B = 2 } via ToString
        var text = v.ToString();
        if (text is not null && text != t.ToString()) return text;

        var props = t.GetProperties(BindingFlags.Public | BindingFlags.Instance)
                     .Where(p => p.CanRead && p.GetIndexParameters().Length == 0);
        return t.Name + " { " + string.Join(", ",
            props.Select(p => p.Name + " = " + Show(p.GetValue(v), depth + 1))) + " }";
    }

    private static List<string> Truncate(List<string> parts)
    {
        if (parts.Count <= 12) return parts;
        var head = parts.Take(12).ToList();
        head.Add("… " + (parts.Count - 12) + " more");
        return head;
    }

    // ── the runner ────────────────────────────────────────────────────────

    private static int _passed, _failed, _todo;
    private static bool _reported;
    // Deliberately very generous. The first web/EF test in a file pays for
    // Kestrel startup plus EF model building, and on a loaded machine that
    // has been measured well past 20s — which made the full-track run flaky
    // while every file passed in isolation. This is a runaway-test guard
    // (catch a deadlock or an infinite loop), NOT a performance budget:
    // a timeout here should mean "hung", never "busy".
    private const int TimeoutMs = 90_000;

    static Check()
    {
        // Mirrors node's `beforeExit`: the summary prints itself, so an
        // exercise file never has to remember to call Report().
        AppDomain.CurrentDomain.ProcessExit += (_, _) => Report();
    }

    public static void Test(string name, Action fn)
        => Test(name, () => { fn(); return Task.CompletedTask; });

    public static void Test(string name, Func<Task> fn)
    {
        try
        {
            RunWithTimeout(fn);
            _passed++;
            Console.WriteLine("  " + Green("✔") + " " + name);
        }
        catch (NotImplementedException)
        {
            _todo++;
            Console.WriteLine("  " + Yellow("☐") + " " + Dim(name) + " " + Yellow("· todo"));
        }
        catch (Exception e)
        {
            _failed++;
            Console.WriteLine("  " + Red("✘") + " " + Bold(name));
            PrintFailure(e);
        }
    }

    // Task.Wait reports failures as AggregateException, which would hide the
    // NotImplementedException that marks a test as "todo". Unwrap it so the
    // original exception reaches the catch clauses above with its type intact.
    private static void RunWithTimeout(Func<Task> fn)
    {
        var task = Task.Run(fn);
        bool finished;
        try
        {
            finished = task.Wait(TimeoutMs);
        }
        catch (AggregateException ae) when (ae.InnerException is not null)
        {
            ExceptionDispatchInfo.Capture(ae.InnerException).Throw();
            return;   // unreachable; Throw() always throws
        }
        if (!finished)
            throw new TimeoutException("timed out after " + (TimeoutMs / 1000) + "s");
        task.GetAwaiter().GetResult();
    }

    private static void PrintFailure(Exception e)
    {
        if (e is CheckFailure cf)
        {
            Console.WriteLine("      " + Red(cf.Message));
            if (cf.HasDiff)
            {
                Console.WriteLine("      expected: " + Green(Show(cf.Expected)));
                Console.WriteLine("      received: " + Red(Show(cf.Actual)));
            }
        }
        else
        {
            Console.WriteLine("      " + Red(e.GetType().Name + ": " + e.Message));
            var line = (e.StackTrace ?? "").Split('\n')
                .FirstOrDefault(l => l.Contains(".cs:line") && !l.Contains("Check.cs:line"));
            if (line is not null) Console.WriteLine("      " + Dim(line.Trim()));
        }
    }

    public static void Report()
    {
        if (_reported) return;
        _reported = true;

        var total = _passed + _failed + _todo;
        var parts = new List<string>();
        if (_passed > 0) parts.Add(Green(_passed + " passed"));
        if (_failed > 0) parts.Add(Red(_failed + " failed"));
        if (_todo > 0) parts.Add(Yellow(_todo + " todo"));
        if (total == 0) parts.Add(Dim("no tests ran"));

        Console.WriteLine("\n  " + string.Join(Dim(" · "), parts));
        if (total > 0 && _failed == 0 && _todo == 0)
            Console.WriteLine("  " + Green(Bold("all green — next file!")));
        // Machine-readable tail; progress.js and verify.js parse this line.
        Console.WriteLine(Dim("  #done passed=" + _passed + " failed=" + _failed + " todo=" + _todo));
        Console.Out.Flush();
        if (_failed > 0) Environment.ExitCode = 1;
    }
}
