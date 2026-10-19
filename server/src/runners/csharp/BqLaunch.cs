// BqLaunch.cs — BootQuest's graded launcher for the C# console-check shape.
// Runner-owned (NOT an upstream harness copy): compiled by scratch.ts into bin/BqLaunch.dll
// next to the upstream Check.dll, against the same refs.
//
//     dotnet bin/BqLaunch.dll <nonce-file> <result-file> <Exercise.dll>
//
// Protocol (the C# twin of javabootcamp's BqMain, see server/src/runners/csharp/index.ts):
//   1. read the nonce from <nonce-file> and DELETE that file, before the exercise
//      assembly is loaded, so code under test can never read it;
//   2. replace Console.Out with the channel writer below. Everything written is
//      passed through to stdout (that is display only). A WriteLine is RECORDED only
//      when its nearest caller outside the framework is the Bootcamp harness
//      assembly (Check.dll):  `  ✔ name` pass, `  ✘ name` fail (+ its `      `
//      detail lines), `  ☐ name todo` / `  ☐ name · todo` todo;
//   3. when the harness prints its `#done passed= failed= todo=` line (Report(),
//      or jstrain's ProcessExit report), the channel writes
//          #bq-result <nonce> <base64 json {passed,failed,todo,tests:[{name,status,detail?}]}>
//      to <result-file> (overwriting: the last harness report wins);
//   4. load Exercise.dll and invoke its entry point.
// A `#done` line printed by learner code is never recorded; no harness report means
// no result file, which the runner treats as a crash (never a pass). The exit code is
// never trusted.
//
// Exit codes of the launcher itself (only when it fails before the entry point runs):
//   2 = usage, 3 = nonce file unreadable / not deletable / malformed, 4 = exercise
//   assembly or entry point missing. An exception out of the entry point exits 1.

using System.Diagnostics;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace BootQuestRuntime.Launch;

internal static class BqLaunch
{
    private static int Main(string[] args)
    {
        if (args.Length != 3)
        {
            Console.Error.WriteLine("usage: dotnet BqLaunch.dll <nonce-file> <result-file> <Exercise.dll>");
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

        var stdout = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true };
        Console.SetOut(new Channel(stdout, nonce, args[1]));

        MethodInfo entry;
        try
        {
            var asm = Assembly.LoadFrom(Path.GetFullPath(args[2]));
            entry = asm.EntryPoint ?? throw new MissingMethodException("the exercise assembly has no entry point");
        }
        catch (Exception e)
        {
            Console.Error.WriteLine("bootquest: cannot launch the exercise: " + e.Message);
            return 4;
        }

        object? ret;
        try
        {
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
}

/// <summary>stdout pass-through that records the harness's own report lines (see the header).</summary>
internal sealed class Channel : TextWriter
{
    private static readonly Regex Done = new(@"^\s*#done passed=(\d+) failed=(\d+) todo=(\d+)\s*$", RegexOptions.CultureInvariant);
    private static readonly string FrameworkDir =
        Path.GetDirectoryName(typeof(object).Assembly.Location) ?? "\0";

    private readonly TextWriter _out;
    private readonly string _nonce;
    private readonly string _resultFile;
    private readonly Assembly _self = typeof(Channel).Assembly;
    private readonly Assembly _harness = typeof(Bootcamp.Check).Assembly; // typeof: no static constructor runs
    private readonly List<Entry> _tests = new();
    private Entry? _lastFail;

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
        var candidate = line.StartsWith("  ✔ ", StringComparison.Ordinal) || line.StartsWith("  ✘ ", StringComparison.Ordinal) ||
                        line.StartsWith("  ☐ ", StringComparison.Ordinal) || line.Contains("#done", StringComparison.Ordinal) ||
                        (_lastFail is not null && line.StartsWith("      ", StringComparison.Ordinal));
        if (!candidate || !FromHarness()) return;
        Observe(line);
    }

    /// The nearest caller outside the framework and this launcher must be the harness assembly.
    private bool FromHarness()
    {
        var frames = new StackTrace(1, false).GetFrames();
        foreach (var frame in frames)
        {
            var method = frame.GetMethod();
            if (method is null) continue;
            var asm = method.DeclaringType?.Assembly ?? method.Module.Assembly;
            if (asm == _self) continue;
            if (!asm.IsDynamic && asm.Location.Length > 0 &&
                asm.Location.StartsWith(FrameworkDir, StringComparison.OrdinalIgnoreCase)) continue;
            return asm == _harness;
        }
        return false;
    }

    private void Observe(string line)
    {
        if (line.StartsWith("  ✔ ", StringComparison.Ordinal))
        {
            _tests.Add(new Entry { Name = line[4..], Status = "pass" });
            _lastFail = null;
        }
        else if (line.StartsWith("  ✘ ", StringComparison.Ordinal))
        {
            _lastFail = new Entry { Name = line[4..], Status = "fail" };
            _tests.Add(_lastFail);
        }
        else if (line.StartsWith("  ☐ ", StringComparison.Ordinal))
        {
            var name = line[4..];
            // github csbootcamp prints `☐ name todo`, jstrain2.2's revision `☐ name · todo`
            if (name.EndsWith(" · todo", StringComparison.Ordinal)) name = name[..^7];
            else if (name.EndsWith(" todo", StringComparison.Ordinal)) name = name[..^5];
            _tests.Add(new Entry { Name = name, Status = "todo" });
            _lastFail = null;
        }
        else if (Done.Match(line) is { Success: true } m)
        {
            _lastFail = null;
            WriteResult(int.Parse(m.Groups[1].Value), int.Parse(m.Groups[2].Value), int.Parse(m.Groups[3].Value));
        }
        else if (_lastFail is not null && line.StartsWith("      ", StringComparison.Ordinal))
        {
            (_lastFail.Detail ??= new StringBuilder()).Append(_lastFail.Detail.Length > 0 ? "\n" : "").Append(line);
        }
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
