// Spy.cs — call recorders, for "did my code call this, how often, with what?"
//
//     var log = new Spy<string>();
//     Retry(3, log.Action);
//     Eq(log.CallCount, 3);
//     Eq(log.Calls[0], "attempt 1");
//
// Spy<T>          records one argument, returns nothing   → .Action
// Spy<T, TResult> records one argument, returns a value    → .Func
// Spy0            records bare calls, no arguments         → .Action

namespace Bootcamp;

/// <summary>Records calls to a one-argument void delegate.</summary>
public sealed class Spy<T>
{
    private readonly Action<T>? _impl;
    public Spy(Action<T>? impl = null) => _impl = impl;

    public List<T> Calls { get; } = [];
    public int CallCount => Calls.Count;

    public Action<T> Action => Invoke;

    public void Invoke(T arg)
    {
        Calls.Add(arg);
        _impl?.Invoke(arg);
    }
}

/// <summary>Records calls to a one-argument delegate that returns a value.</summary>
public sealed class Spy<T, TResult>
{
    private readonly Func<T, TResult> _impl;
    public Spy(Func<T, TResult> impl) => _impl = impl;

    public List<T> Calls { get; } = [];
    public List<TResult> Returns { get; } = [];
    public int CallCount => Calls.Count;

    public Func<T, TResult> Func => Invoke;

    public TResult Invoke(T arg)
    {
        Calls.Add(arg);
        var result = _impl(arg);
        Returns.Add(result);
        return result;
    }
}

/// <summary>Records bare calls — no arguments, no return value.</summary>
public sealed class Spy0
{
    private readonly Action? _impl;
    public Spy0(Action? impl = null) => _impl = impl;

    public int CallCount { get; private set; }

    public Action Action => Invoke;

    public void Invoke()
    {
        CallCount++;
        _impl?.Invoke();
    }
}
