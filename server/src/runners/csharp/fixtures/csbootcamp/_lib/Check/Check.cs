// Check.cs — the bootcamp's tiny test harness. Zero dependencies, BCL only.
//
// Every exercise file references this project and is run directly:
//
//     dotnet run 03-count-vowels.cs
//
// API (bring it in with `using static Bootcamp.Check;`):
//   Test(name, body)            register + run a test (Action or Func<Task>)
//   Eq(actual, expected, msg?)  deep structural equality
//   Ok(value, msg?)             assert true
//   Throws<TEx>(fn, contains?)  fn must throw TEx (message substring optional)
//   ThrowsAsync<TEx>(fn, ...)   async version
//   Approx(actual, exp, eps?)   floating-point comparison (default 1e-9)
//   Spy / Spy<T>                call recorder: Calls, CallCount, Returns
//   Sleep(ms)                   await a real delay
//   Report()                    print the summary, return the exit code
//
// A test whose code throws NotImplementedException — that is what every
// starter stub throws — is reported as "todo", not as a failure. That is the
// "you haven't written it yet" state, and it keeps an untouched exercise
// green-ish rather than shouting at you.

namespace Bootcamp;

using System.Collections;
using System.Diagnostics.CodeAnalysis;
using System.Globalization;
using System.Text;

public static class Check
{
    private static readonly List<Result> Results = [];
    private static readonly bool UseColor =
        !Console.IsOutputRedirected && Environment.GetEnvironmentVariable("NO_COLOR") is null;

    private enum Outcome { Pass, Fail, Todo }

    private readonly record struct Result(Outcome Outcome, string Name, string? Detail);

    // ── colour ────────────────────────────────────────────────────────────

    private const string Esc = "\u001b";

    private static string C(string code, string s) => UseColor ? $"{Esc}[{code}m{s}{Esc}[0m" : s;
    private static string Green(string s) => C("32", s);
    private static string Red(string s) => C("31", s);
    private static string Yellow(string s) => C("33", s);
    private static string Dim(string s) => C("2", s);

    // ── the failure type ──────────────────────────────────────────────────

    public sealed class CheckFailure : Exception
    {
        public CheckFailure(string message, string? actual = null, string? expected = null)
            : base(message)
        {
            Actual = actual;
            Expected = expected;
        }

        public string? Actual { get; }
        public string? Expected { get; }
    }

    // ── running a test ────────────────────────────────────────────────────

    public static void Test(string name, Action body)
    {
        try
        {
            body();
            Record(Outcome.Pass, name, null);
        }
        catch (Exception ex)
        {
            RecordThrow(name, ex);
        }
    }

    public static void Test(string name, Func<Task> body)
    {
        try
        {
            body().GetAwaiter().GetResult();
            Record(Outcome.Pass, name, null);
        }
        catch (Exception ex)
        {
            RecordThrow(name, ex);
        }
    }

    private static void RecordThrow(string name, Exception ex)
    {
        if (IsTodo(ex))
        {
            Record(Outcome.Todo, name, null);
            return;
        }

        if (ex is CheckFailure failure)
        {
            var detail = new StringBuilder(failure.Message);
            if (failure.Expected is not null || failure.Actual is not null)
            {
                detail.Append('\n').Append(Dim("      expected: ")).Append(failure.Expected ?? "-");
                detail.Append('\n').Append(Dim("      received: ")).Append(failure.Actual ?? "-");
            }

            Record(Outcome.Fail, name, detail.ToString());
            return;
        }

        var line = FirstUserFrame(ex);
        Record(Outcome.Fail, name, $"{ex.GetType().Name}: {ex.Message}{(line is null ? "" : "\n" + Dim("      at " + line))}");
    }

    private static bool IsTodo(Exception ex) =>
        ex is NotImplementedException || ex.Message.StartsWith("TODO", StringComparison.Ordinal);

    private static string? FirstUserFrame(Exception ex) =>
        ex.StackTrace?
            .Split('\n')
            .Select(l => l.Trim())
            .FirstOrDefault(l => l.Contains(".cs:line", StringComparison.Ordinal));

    private static void Record(Outcome outcome, string name, string? detail)
    {
        Results.Add(new Result(outcome, name, detail));
        switch (outcome)
        {
            case Outcome.Pass:
                Console.WriteLine($"  {Green("✔")} {name}");
                break;
            case Outcome.Todo:
                Console.WriteLine($"  {Yellow("☐")} {name} {Dim("todo")}");
                break;
            default:
                Console.WriteLine($"  {Red("✘")} {name}");
                if (detail is not null) Console.WriteLine($"      {detail}");
                break;
        }
    }

    // ── the summary ───────────────────────────────────────────────────────

    public static int Report()
    {
        var passed = Results.Count(r => r.Outcome == Outcome.Pass);
        var failed = Results.Count(r => r.Outcome == Outcome.Fail);
        var todo = Results.Count(r => r.Outcome == Outcome.Todo);

        var parts = new List<string> { $"{passed} passed" };
        if (failed > 0) parts.Add(Red($"{failed} failed"));
        if (todo > 0) parts.Add(Yellow($"{todo} todo"));

        Console.WriteLine();
        Console.WriteLine("  " + string.Join(" · ", parts));
        if (failed == 0 && todo == 0 && passed > 0)
        {
            Console.WriteLine("  " + Green("all green — next file!"));
        }

        // The machine-readable line the tools parse. Keep the format stable.
        Console.WriteLine($"  #done passed={passed} failed={failed} todo={todo}");
        return failed > 0 ? 1 : 0;
    }

    // ── assertions ────────────────────────────────────────────────────────

    public static void Eq<T>(T actual, T expected, string message = "values differ")
    {
        if (!DeepEquals(actual, expected))
        {
            throw new CheckFailure(message, Show(actual), Show(expected));
        }
    }

    public static void Ok([DoesNotReturnIf(false)] bool value, string message = "expected true")
    {
        if (!value) throw new CheckFailure(message);
    }

    public static void Approx(double actual, double expected, double eps = 1e-9,
        string message = "numbers differ")
    {
        if (double.IsNaN(actual) || Math.Abs(actual - expected) > eps)
        {
            throw new CheckFailure(message, Show(actual), Show(expected));
        }
    }

    public static TEx Throws<TEx>(Action body, string? messageContains = null)
        where TEx : Exception
    {
        try
        {
            body();
        }
        catch (Exception ex) when (IsTodo(ex))
        {
            throw; // unimplemented code isn't a real throw
        }
        catch (Exception ex)
        {
            return MatchThrown<TEx>(ex, messageContains);
        }

        throw new CheckFailure($"expected a {typeof(TEx).Name} but nothing was thrown");
    }

    public static async Task<TEx> ThrowsAsync<TEx>(Func<Task> body, string? messageContains = null)
        where TEx : Exception
    {
        try
        {
            await body();
        }
        catch (Exception ex) when (IsTodo(ex))
        {
            throw;
        }
        catch (Exception ex)
        {
            return MatchThrown<TEx>(ex, messageContains);
        }

        throw new CheckFailure($"expected a {typeof(TEx).Name} but the task completed");
    }

    private static TEx MatchThrown<TEx>(Exception ex, string? messageContains) where TEx : Exception
    {
        if (ex is not TEx typed)
        {
            throw new CheckFailure("threw, but the wrong exception type",
                ex.GetType().Name, typeof(TEx).Name);
        }

        if (messageContains is not null &&
            !typed.Message.Contains(messageContains, StringComparison.OrdinalIgnoreCase))
        {
            throw new CheckFailure("threw, but the message was wrong",
                Show(typed.Message), Show(messageContains));
        }

        return typed;
    }

    public static Task Sleep(int milliseconds) => Task.Delay(milliseconds);

    // ── deep equality ─────────────────────────────────────────────────────
    //
    // Records, tuples, primitives and strings already have value equality, so
    // Equals is the right first question. Sequences and dictionaries do not:
    // two Lists holding equal items are not Equal, which is never what a test
    // means, so they are compared element by element.

    public static bool DeepEquals(object? a, object? b)
    {
        if (ReferenceEquals(a, b)) return true;
        if (a is null || b is null) return false;

        if (a is string sa && b is string sb) return sa == sb;

        if (a is double da && b is double db) return da.Equals(db);
        if (a is float fa && b is float fb) return fa.Equals(fb);

        if (a is IDictionary mapA && b is IDictionary mapB)
        {
            if (mapA.Count != mapB.Count) return false;
            foreach (DictionaryEntry entry in mapA)
            {
                if (!mapB.Contains(entry.Key)) return false;
                if (!DeepEquals(entry.Value, mapB[entry.Key])) return false;
            }

            return true;
        }

        if (a is IEnumerable seqA && b is IEnumerable seqB)
        {
            var itA = seqA.GetEnumerator();
            var itB = seqB.GetEnumerator();
            try
            {
                while (true)
                {
                    var moreA = itA.MoveNext();
                    var moreB = itB.MoveNext();
                    if (moreA != moreB) return false;
                    if (!moreA) return true;
                    if (!DeepEquals(itA.Current, itB.Current)) return false;
                }
            }
            finally
            {
                (itA as IDisposable)?.Dispose();
                (itB as IDisposable)?.Dispose();
            }
        }

        return a.Equals(b);
    }

    // ── rendering values in a failure message ─────────────────────────────

    public static string Show(object? value, int depth = 0)
    {
        switch (value)
        {
            case null:
                return "null";
            case string s:
                return depth == 0 ? $"\"{s}\"" : $"\"{s}\"";
            case bool b:
                return b ? "true" : "false";
            case double d:
                return d.ToString("R", CultureInfo.InvariantCulture);
            case decimal m:
                return m.ToString(CultureInfo.InvariantCulture) + "m";
            case IDictionary map:
                {
                    if (depth > 4) return "{ … }";
                    var entries = new List<string>();
                    foreach (DictionaryEntry e in map)
                    {
                        entries.Add($"{Show(e.Key, depth + 1)}: {Show(e.Value, depth + 1)}");
                    }

                    return "{ " + string.Join(", ", entries) + " }";
                }
            case IEnumerable seq:
                {
                    if (depth > 4) return "[ … ]";
                    var items = new List<string>();
                    foreach (var item in seq)
                    {
                        if (items.Count == 12) { items.Add("…"); break; }
                        items.Add(Show(item, depth + 1));
                    }

                    return "[" + string.Join(", ", items) + "]";
                }
            default:
                return value.ToString() ?? value.GetType().Name;
        }
    }
}

// ── Spy: a call recorder, for testing that something was called ───────────
//
//     var spy = new Spy<int>();          // records calls, returns default
//     var spy = new Spy<int>(x => x * 2) // records calls, runs the impl
//     spy.CallCount, spy.Calls[0], spy.Returns[0]

public sealed class Spy
{
    private readonly Action<object?[]>? _impl;

    public Spy(Action<object?[]>? impl = null) => _impl = impl;

    public List<object?[]> Calls { get; } = [];
    public int CallCount => Calls.Count;

    public void Invoke(params object?[] args)
    {
        Calls.Add(args);
        _impl?.Invoke(args);
    }
}

public sealed class Spy<TResult>
{
    private readonly Func<object?[], TResult>? _impl;

    public Spy(Func<object?[], TResult>? impl = null) => _impl = impl;

    public List<object?[]> Calls { get; } = [];
    public List<TResult?> Returns { get; } = [];
    public int CallCount => Calls.Count;

    public TResult? Invoke(params object?[] args)
    {
        Calls.Add(args);
        var result = _impl is null ? default : _impl(args);
        Returns.Add(result);
        return result;
    }
}
