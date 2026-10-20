// BqLaunch.cs — BootQuest's graded launcher for the C# console-check shape.
// Runner-owned (NOT an upstream harness copy): compiled by scratch.ts into bin/BqLaunch.dll
// next to the upstream Check.dll, against the same refs.
//
//     dotnet bin/BqLaunch.dll <nonce-file> <result-file> <Exercise.dll> <gate>
//
// Protocol (the C# twin of javabootcamp's BqMain, see server/src/runners/csharp/index.ts):
//   1. read the nonce from <nonce-file> and DELETE that file before the exercise
//      assembly is loaded, so learner code can never read it from disk. (It still lives
//      in this process's memory: same-process reflection into the launcher can reach it.
//      That is out of scope, see index.ts; what keeps the harness's own PUBLIC API from
//      forging a verdict is the stack rule below, not the nonce.)
//   2. replace Console.Out with the channel writer below. Everything written is passed
//      through to stdout (display only). The runner wrapped the canonical tests block
//      in a local function named <gate> (a fresh random name per grade, see
//      csbootcamp-split.ts wrapTestsBlock); the launcher refuses to run a program in
//      which that wrapper does not exist (the block was commented / #if'd / swallowed
//      away). A line is RECORDED only by this stack rule:
//        `  ✔ name` pass, `  ✘ name` fail (+ its `      ` detail lines), `  ☐ name todo` /
//        `  ☐ name · todo` todo: printed by a contiguous run of Check.dll frames that
//        contains Check.Test, whose caller is DIRECTLY the <gate> wrapper, whose caller
//        is DIRECTLY the exercise's entry point, with nothing but the launcher (and the
//        framework's reflection frames) beneath, after the launcher invoked the entry
//        point. Exactly one Check.Test run on the stack: a Test() called from inside a
//        test body has learner frames between it and the wrapper.
//      A Check.Test record printed any other way (learner code calling Test(), a
//      [ModuleInitializer], a test body) is real harness output for a test that is not
//      the canonical one: it is displayed, NOT recorded, and subtracted from the
//      harness's tallies when its report arrives.
//   3. `#done passed= failed= todo=` is accepted only from Check.Report called directly
//      by the wrapper (csbootcamp's `return Report();`) or from the jstrain revision's
//      ProcessExit hook (Report under the lambda Check's static constructor registered,
//      with only runtime frames beneath), after the entry point was invoked. Then the
//      channel writes
//          #bq-result <nonce> <base64 json {passed,failed,todo,tests:[{name,status,detail?}]}>
//      to <result-file> (overwriting: the last accepted report wins), with the tallies
//      minus the non-canonical records. The runner rejects a result whose tallies
//      disagree with its test list (a harness counter changed behind its back).
//   4. module initializers of Exercise.dll run BEFORE the entry flag is set, so nothing
//      a [ModuleInitializer] prints can be recorded; then the entry point is invoked.
// A `#done` line printed by learner code is never recorded; no accepted report means no
// result file, which the runner treats as a crash (never a pass). The exit code is
// never trusted.
//
// Exit codes of the launcher itself (only when it fails before the entry point runs):
//   2 = usage, 3 = nonce file unreadable / not deletable / malformed, 4 = exercise
//   assembly, entry point or tests wrapper missing. An exception out of the entry point
//   (or out of a module initializer) exits 1.

using System.Diagnostics;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace BootQuestRuntime.Launch;

internal static class BqLaunch
{
    private static int Main(string[] args)
    {
        if (args.Length != 4)
        {
            Console.Error.WriteLine("usage: dotnet BqLaunch.dll <nonce-file> <result-file> <Exercise.dll> <gate>");
            return 2;
        }

        string nonce;
        try
        {
            nonce = File.ReadAllText(args[0]).Trim();
            File.Delete(args[0]);
        }
        catch (Exception e)
        {
            Console.Error.WriteLine("bootquest: nonce file unreadable or not deletable: " + e.Message);
            return 3;
        }
        if (nonce.Length == 0 || !Regex.IsMatch(nonce, "^[A-Za-z0-9_-]+$"))
        {
            Console.Error.WriteLine("bootquest: nonce file is empty or malformed");
            return 3;
        }
        var gate = args[3];
        if (!Regex.IsMatch(gate, "^__bqTests_[0-9a-f]{16}$"))
        {
            Console.Error.WriteLine("bootquest: malformed gate name");
            return 2;
        }

        var stdout = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true };
        var channel = new Channel(stdout, nonce, args[1]);
        Console.SetOut(channel);

        Assembly asm;
        MethodInfo entry;
        MethodBase wrapper;
        try
        {
            asm = Assembly.LoadFrom(Path.GetFullPath(args[2]));
            entry = asm.EntryPoint ?? throw new MissingMethodException("the exercise assembly has no entry point");
            wrapper = FindWrapper(entry, gate);
        }
        catch (Exception e)
        {
            Console.Error.WriteLine("bootquest: cannot launch the exercise: " + e.Message);
            return 4;
        }
        channel.Arm(asm, entry, wrapper);

        // module initializers run now, while nothing can be recorded
        try
        {
            RuntimeHelpers.RunModuleConstructor(asm.ManifestModule.ModuleHandle);
        }
        catch (Exception e)
        {
            Console.Out.Flush();
            Console.Error.WriteLine("Unhandled exception. " + (e is TypeInitializationException { InnerException: { } inner } ? inner : e));
            return 1;
        }

        object? ret;
        try
        {
            Channel.EntryInvoked = true;
            ret = entry.Invoke(null, entry.GetParameters().Length == 0 ? null : new object?[] { Array.Empty<string>() });
            if (ret is Task task)
            {
                task.GetAwaiter().GetResult();
                ret = null;
            }
        }
        catch (TargetInvocationException e) when (e.InnerException is not null)
        {
            Console.Out.Flush();
            Console.Error.WriteLine("Unhandled exception. " + e.InnerException);
            return 1;
        }
        Console.Out.Flush();
        return ret is int code ? code : Environment.ExitCode;
    }

    /// The one method compiled from `<gate>`: a local function of the top-level program
    /// (on Program itself, or on a closure class nested in it when it captures).
    private static MethodBase FindWrapper(MethodInfo entry, string gate)
    {
        var program = entry.DeclaringType ?? throw new MissingMethodException("the entry point has no declaring type");
        var found = new List<MethodBase>();
        var types = new Stack<Type>();
        types.Push(program);
        while (types.Count > 0)
        {
            var t = types.Pop();
            const BindingFlags all = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static | BindingFlags.Instance | BindingFlags.DeclaredOnly;
            foreach (var m in t.GetMethods(all))
                if (m.Name.Contains(">g__" + gate + "|", StringComparison.Ordinal)) found.Add(m);
            foreach (var n in t.GetNestedTypes(all)) types.Push(n);
        }
        if (found.Count != 1)
            throw new MissingMethodException(found.Count == 0
                ? "the canonical tests block is missing from the program (commented out or otherwise disabled); not graded"
                : "the canonical tests wrapper is ambiguous; not graded");
        return found[0];
    }
}

/// <summary>stdout pass-through that records the canonical harness report lines (see the header).</summary>
internal sealed class Channel : TextWriter
{
    /// set by the launcher immediately before it invokes the entry point
    public static volatile bool EntryInvoked;

    private static readonly Regex Done = new(@"^\s*#done passed=(\d+) failed=(\d+) todo=(\d+)\s*$", RegexOptions.CultureInvariant);
    private static readonly string FrameworkDir =
        Path.GetDirectoryName(typeof(object).Assembly.Location) ?? "\0";

    private readonly TextWriter _out;
    private readonly string _nonce;
    private readonly string _resultFile;
    private readonly Assembly _self = typeof(Channel).Assembly;
    private readonly Assembly _harness = typeof(Bootcamp.Check).Assembly; // typeof: no static constructor runs
    private Assembly? _exercise;
    private MethodBase? _entry;
    private MethodBase? _wrapper;
    private readonly List<Entry> _tests = new();
    private Entry? _lastFail;
    /// harness records of non-canonical Test() calls: displayed, never graded, subtracted from the report
    private int _otherPassed, _otherFailed, _otherTodo;

    private enum Origin { Foreign, CanonicalTest, OtherTest, Report }

    private sealed class Entry
    {
        public required string Name;
        public required string Status;
        public StringBuilder? Detail;
    }

    public Channel(TextWriter output, string nonce, string resultFile)
    {
        _out = output;
        _nonce = nonce;
        _resultFile = resultFile;
    }

    public void Arm(Assembly exercise, MethodBase entry, MethodBase wrapper)
    {
        _exercise = exercise;
        _entry = entry;
        _wrapper = wrapper;
    }

    public override Encoding Encoding => _out.Encoding;
    public override void Write(char value) => _out.Write(value);
    public override void Write(string? value) => _out.Write(value);
    public override void Write(char[] buffer, int index, int count) => _out.Write(buffer, index, count);
    public override void Flush() => _out.Flush();

    public override void WriteLine(string? value)
    {
        _out.WriteLine(value);
        var line = value ?? "";
        // only lines shaped like a harness record are worth a stack walk
        var record = line.StartsWith("  ✔ ", StringComparison.Ordinal) || line.StartsWith("  ✘ ", StringComparison.Ordinal) ||
                     line.StartsWith("  ☐ ", StringComparison.Ordinal);
        var done = Done.IsMatch(line);
        var detail = _lastFail is not null && line.StartsWith("      ", StringComparison.Ordinal);
        if (!record && !done && !detail) return;
        var origin = Classify();
        if (record) ObserveRecord(line, origin);
        else if (done) ObserveDone(line, origin);
        else if (origin == Origin.CanonicalTest) AppendDetail(line);
    }

    private static bool IsFramework(Assembly asm) =>
        !asm.IsDynamic && asm.Location.Length > 0 && asm.Location.StartsWith(FrameworkDir, StringComparison.OrdinalIgnoreCase);

    private static bool Same(MethodBase m, MethodBase? want) =>
        want is not null && m.MetadataToken == want.MetadataToken && m.Module.Equals(want.Module);

    /// Where the line being written came from (the stack rule of the header).
    private Origin Classify()
    {
        if (_wrapper is null) return Origin.Foreign; // not armed yet
        var frames = new StackTrace(2, false).GetFrames(); // skip Classify + WriteLine
        var methods = new List<MethodBase>(frames.Length);
        foreach (var f in frames)
            if (f.GetMethod() is { } m) methods.Add(m);
        static Assembly AsmOf(MethodBase m) => m.DeclaringType?.Assembly ?? m.Module.Assembly;

        var i = 0;
        // the writer chain above the printing code: this launcher + Console / SyncTextWriter
        while (i < methods.Count && (AsmOf(methods[i]) == _self || IsFramework(AsmOf(methods[i])))) i++;
        var start = i;
        bool sawTest = false, sawReport = false, sawCctorHook = false;
        while (i < methods.Count && AsmOf(methods[i]) == _harness)
        {
            if (methods[i].Name == "Test") sawTest = true;
            else if (methods[i].Name == "Report") sawReport = true;
            else if (methods[i].Name.StartsWith("<.cctor>", StringComparison.Ordinal)) sawCctorHook = true;
            i++;
        }
        if (i == start || sawTest == sawReport) return Origin.Foreign; // not harness output (or a shape the harness never prints)
        if (sawTest) return EntryInvoked && CanonicalBelow(methods, i) ? Origin.CanonicalTest : Origin.OtherTest;
        if (!EntryInvoked) return Origin.Foreign;
        if (CanonicalBelow(methods, i)) return Origin.Report; // csbootcamp: `return Report();` in the wrapper
        // jstrain: the harness's own ProcessExit hook (the lambda its static constructor
        // registered) with nothing but the runtime beneath it. A learner-registered handler,
        // a thread started on Report, or a reflective call leaves a non-runtime frame below
        // (or no hook frame at all).
        if (sawCctorHook && OnlyRuntimeBelow(methods, i)) return Origin.Report;
        return Origin.Foreign;
    }

    private static bool OnlyRuntimeBelow(List<MethodBase> methods, int i)
    {
        for (var j = i; j < methods.Count; j++)
            if (!IsFramework(methods[j].DeclaringType?.Assembly ?? methods[j].Module.Assembly)) return false;
        return true;
    }

    /// methods[i] is the wrapper, methods[i+1] the entry point, and below that only the launcher + framework.
    private bool CanonicalBelow(List<MethodBase> methods, int i)
    {
        if (i + 1 >= methods.Count || !Same(methods[i], _wrapper) || !Same(methods[i + 1], _entry)) return false;
        var launcher = false;
        for (var j = i + 2; j < methods.Count; j++)
        {
            var asm = methods[j].DeclaringType?.Assembly ?? methods[j].Module.Assembly;
            if (asm == _exercise || asm == _harness) return false;
            if (asm == _self) launcher = true;
        }
        return launcher;
    }

    private void ObserveRecord(string line, Origin origin)
    {
        _lastFail = null;
        string status;
        string name = line[4..];
        if (line.StartsWith("  ✔ ", StringComparison.Ordinal)) status = "pass";
        else if (line.StartsWith("  ✘ ", StringComparison.Ordinal)) status = "fail";
        else
        {
            status = "todo";
            // github csbootcamp prints `☐ name todo`, jstrain2.2's revision `☐ name · todo`
            if (name.EndsWith(" · todo", StringComparison.Ordinal)) name = name[..^7];
            else if (name.EndsWith(" todo", StringComparison.Ordinal)) name = name[..^5];
        }
        if (origin == Origin.OtherTest)
        {
            if (status == "pass") _otherPassed++;
            else if (status == "fail") _otherFailed++;
            else _otherTodo++;
            return;
        }
        if (origin != Origin.CanonicalTest) return;
        var e = new Entry { Name = name, Status = status };
        _tests.Add(e);
        if (status == "fail") _lastFail = e;
    }

    private void AppendDetail(string line)
    {
        (_lastFail!.Detail ??= new StringBuilder()).Append(_lastFail.Detail.Length > 0 ? "\n" : "").Append(line);
    }

    private void ObserveDone(string line, Origin origin)
    {
        if (origin != Origin.Report) return;
        _lastFail = null;
        var m = Done.Match(line);
        int passed = int.Parse(m.Groups[1].Value) - _otherPassed;
        int failed = int.Parse(m.Groups[2].Value) - _otherFailed;
        int todo = int.Parse(m.Groups[3].Value) - _otherTodo;
        if (passed < 0 || failed < 0 || todo < 0)
        {
            Console.Error.WriteLine("bootquest: the harness report disagrees with the records it printed; not graded");
            return;
        }
        WriteResult(passed, failed, todo);
    }

    private void WriteResult(int passed, int failed, int todo)
    {
        using var buffer = new MemoryStream();
        using (var json = new Utf8JsonWriter(buffer))
        {
            json.WriteStartObject();
            json.WriteNumber("passed", passed);
            json.WriteNumber("failed", failed);
            json.WriteNumber("todo", todo);
            json.WriteStartArray("tests");
            foreach (var t in _tests)
            {
                json.WriteStartObject();
                json.WriteString("name", t.Name);
                json.WriteString("status", t.Status);
                if (t.Detail is not null) json.WriteString("detail", t.Detail.ToString());
                json.WriteEndObject();
            }
            json.WriteEndArray();
            json.WriteEndObject();
        }
        File.WriteAllText(_resultFile, "#bq-result " + _nonce + " " + Convert.ToBase64String(buffer.ToArray()) + "\n", new UTF8Encoding(false));
    }
}
