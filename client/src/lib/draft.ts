// In-progress work that must survive a refresh, a misclick or a navigation (the code editor
// used to reset to the starter on every visit), plus a guard for the one case where it cannot:
// browser storage is unavailable (private window, blocked site data, quota) and the work exists
// only in memory.
//
// Everything touching storage is wrapped in try/catch: a throwing or missing localStorage
// degrades to "not saved" (the guard then protects the work); it never breaks rendering.
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { UNSAFE_NavigationContext } from 'react-router-dom';

const PREFIX = 'bq:';
const DRAFT_PREFIX = `${PREFIX}draft:v1:`;

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** The raw value under a FULL storage key (null when absent, unreadable or storage is unavailable). */
function rawGet(fullKey: string): string | null {
  try {
    return storage()?.getItem(fullKey) ?? null;
  } catch {
    return null;
  }
}

/** Store (or, with null, remove) a raw value under a FULL storage key; false when storage refused it. */
function rawSet(fullKey: string, value: string | null): boolean {
  try {
    const s = storage();
    if (!s) return false;
    if (value === null) s.removeItem(fullKey);
    else s.setItem(fullKey, value);
    return true;
  } catch {
    return false;
  }
}

/** A small value stored under `bq:<key>` (null when absent, unreadable or storage is unavailable). */
export function storedGet(key: string): string | null {
  return rawGet(PREFIX + key);
}

/** Store (or, with null, remove) a small value under `bq:<key>`; false when storage refused it. */
export function storedSet(key: string, value: string | null): boolean {
  return rawSet(PREFIX + key, value);
}

/** Short, stable FNV-1a hash of the parts (a content fingerprint for draft keys, not security). */
export function contentHash(...parts: (string | number | null | undefined)[]): string {
  let h = 0x811c9dc5;
  const s = parts.map((p) => (p === null || p === undefined ? '' : String(p))).join('\u0000');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function readDraft(key: string): string | null {
  const raw = storedGet(`draft:v1:${key}`);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as { value?: unknown };
    return typeof parsed?.value === 'string' ? parsed.value : null;
  } catch {
    return null;
  }
}

/** Stored draft keys of `family` other than `key` (drafts for an older version of the content). */
function staleKeys(family: string, key: string): string[] {
  try {
    const s = storage();
    if (!s) return [];
    const out: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k !== null && k.startsWith(DRAFT_PREFIX + family) && k !== DRAFT_PREFIX + key) out.push(k);
    }
    return out;
  } catch {
    return [];
  }
}

export interface Draft {
  value: string;
  setValue: (v: string) => void;
  /** the value on mount came from a stored draft */
  restored: boolean;
  /** a stored draft for an OLDER version of this content (another key of the family) was dropped */
  discardedStale: boolean;
  /** the current value is safe in storage (or equals `initial`, so nothing would be lost) */
  persisted: boolean;
  /** forget the stored draft; the current value stays on screen */
  clear: () => void;
}

interface DraftState {
  key: string;
  value: string;
  restored: boolean;
  discardedStale: boolean;
  persisted: boolean;
}

function initDraft(key: string, initial: string, family: string | undefined): DraftState {
  const stored = readDraft(key);
  return {
    key,
    value: stored ?? initial,
    restored: stored !== null && stored !== initial,
    discardedStale: family !== undefined && staleKeys(family, key).length > 0,
    persisted: true,
  };
}

/**
 * A string value mirrored to localStorage under `key`. Pass a `family` (a prefix of `key`, e.g.
 * `code:<unitId>:`) and the key's remainder as a content hash: when the content changes (a
 * re-seed), the key changes, the old draft no longer matches and is removed (`discardedStale`).
 * A value equal to `initial` is not stored (there is nothing to restore).
 */
export function useDraft(key: string, initial: string, opts: { family?: string } = {}): Draft {
  const { family } = opts;
  const [state, setState] = useState<DraftState>(() => initDraft(key, initial, family));
  // a new key (another unit / re-seeded content) re-reads storage, during render (no stale frame)
  let current = state;
  if (state.key !== key) {
    current = initDraft(key, initial, family);
    setState(current);
  }

  // drop drafts written for an older version of the content (side effect kept out of render)
  useEffect(() => {
    if (family === undefined) return;
    for (const k of staleKeys(family, key)) {
      try {
        storage()?.removeItem(k);
      } catch {
        /* storage refused: the stale draft just stays unreadable under its old key */
      }
    }
  }, [family, key]);

  const initialRef = useRef(initial);
  initialRef.current = initial;

  const setValue = useCallback(
    (v: string) => {
      const ok = v === initialRef.current ? storedSet(`draft:v1:${key}`, null) : storedSet(`draft:v1:${key}`, JSON.stringify({ value: v, savedAt: Date.now() }));
      setState((s) => ({ ...s, key, value: v, persisted: ok || v === initialRef.current }));
    },
    [key],
  );

  const clear = useCallback(() => {
    storedSet(`draft:v1:${key}`, null);
    setState((s) => ({ ...s, restored: false, persisted: true }));
  }, [key]);

  return { value: current.value, setValue, restored: current.restored, discardedStale: current.discardedStale, persisted: current.persisted, clear };
}

export interface JsonDraft<T> {
  value: T;
  /** replace the value, or derive it from the previous one */
  set: (next: T | ((prev: T) => T)) => void;
  /** the value on mount came from a stored (valid, non-empty) draft */
  restored: boolean;
  /** back to `empty` (which removes the stored entry) */
  clear: () => void;
}

export interface JsonDraftOptions<T> {
  /** validate a stored value; null rejects it (wrong shape, another item's draft) */
  parse: (raw: unknown) => T | null;
  /** an empty value is never stored (writing one removes the entry). Pass a STABLE function. */
  isEmpty: (v: T) => boolean;
}

/**
 * A structured draft (any JSON value: several answers, a findings table, a help flag) mirrored
 * to localStorage as plain JSON under `storageKey`, a FULL storage key (not prefixed with `bq:`
 * here, so callers own their key format: the ladder panes keep `bq:ladder-draft:{eb|kata}:<unit>:<hash>`).
 * A null key stores nothing. A valid, non-empty stored draft is restored on mount; every change
 * is written after render; an empty value removes the entry. Unlike useDraft (one string, keyed
 * by content family), the key is read once on mount: a caller whose key can change remounts.
 */
export function useJsonDraft<T>(storageKey: string | null, empty: T, { parse, isEmpty }: JsonDraftOptions<T>): JsonDraft<T> {
  const [state, setState] = useState<{ value: T; restored: boolean }>(() => {
    let v: T | null = null;
    if (storageKey !== null) {
      const raw = rawGet(storageKey);
      try {
        v = raw === null ? null : parse(JSON.parse(raw) as unknown);
      } catch {
        v = null; // unreadable draft: a draft is a convenience, never the record
      }
    }
    return v !== null && !isEmpty(v) ? { value: v, restored: true } : { value: empty, restored: false };
  });
  const { value } = state;
  useEffect(() => {
    // quota / private mode: rawSet swallows the failure (the draft is a convenience, never the record)
    if (storageKey !== null) rawSet(storageKey, isEmpty(value) ? null : JSON.stringify(value));
  }, [storageKey, value, isEmpty]);
  const set = (next: T | ((prev: T) => T)) =>
    setState((s) => ({ ...s, value: typeof next === 'function' ? (next as (prev: T) => T)(s.value) : next }));
  const clear = () => setState({ value: empty, restored: false });
  return { value, set, clear, restored: state.restored };
}

export const LEAVE_MESSAGE = 'Your code changes are not saved anywhere (this browser is not storing drafts). Leave this page and lose them?';

export interface DirtyGuardOptions {
  /** the in-app confirm text (default LEAVE_MESSAGE) */
  message?: string;
  /** also confirm in-app navigations (default true) */
  inApp?: boolean;
}

/**
 * While `dirty`, leaving loses work: a reload / tab close asks via `beforeunload`, and an in-app
 * navigation (links, g-chords, navigate()) asks via window.confirm first. The app runs on a plain
 * <BrowserRouter> (no data router, so no useBlocker): the in-app half wraps the router's navigator
 * push/replace for as long as the guard is armed and restores them afterwards. Browser
 * back/forward (popstate) cannot be cancelled this way; beforeunload does not cover it either.
 *
 * `inApp: false` arms only the tab close / reload half (the ladder panes: their drafts are in
 * storage, so an in-app navigation loses nothing; a closing tab still asks while one is dirty).
 * A string second argument is the message (the original signature).
 */
export function useDirtyGuard(dirty: boolean, opts: string | DirtyGuardOptions = {}): void {
  const { message = LEAVE_MESSAGE, inApp = true } = typeof opts === 'string' ? { message: opts } : opts;
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // legacy browsers need a returnValue to show the prompt
      e.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const nav = useContext(UNSAFE_NavigationContext)?.navigator as
    | { push: (...args: unknown[]) => void; replace: (...args: unknown[]) => void }
    | undefined;
  useEffect(() => {
    if (!dirty || !inApp || !nav) return;
    const { push, replace } = nav;
    const ask = (): boolean => {
      try {
        return window.confirm(message);
      } catch {
        return true; // no confirm available: never trap the learner on the page
      }
    };
    nav.push = (...args: unknown[]) => {
      if (ask()) push.apply(nav, args);
    };
    nav.replace = (...args: unknown[]) => {
      if (ask()) replace.apply(nav, args);
    };
    return () => {
      nav.push = push;
      nav.replace = replace;
    };
  }, [dirty, inApp, nav, message]);
}
