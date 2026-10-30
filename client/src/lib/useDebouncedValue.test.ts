import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDebouncedValue } from './useDebouncedValue';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useDebouncedValue', () => {
  it('returns the initial value at once (a live region fed by it is silent on mount)', () => {
    const { result } = renderHook(() => useDebouncedValue('Showing 3 of 3', 500));
    expect(result.current).toBe('Showing 3 of 3');
  });

  it('follows a burst of changes only once they pause for the delay', () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 500), { initialProps: { v: 'a' } });
    rerender({ v: 'ab' });
    act(() => vi.advanceTimersByTime(300));
    rerender({ v: 'abc' });
    act(() => vi.advanceTimersByTime(300));
    // 600 ms since the first change, but only 300 ms since the last one
    expect(result.current).toBe('a');
    act(() => vi.advanceTimersByTime(200));
    expect(result.current).toBe('abc');
  });
});
