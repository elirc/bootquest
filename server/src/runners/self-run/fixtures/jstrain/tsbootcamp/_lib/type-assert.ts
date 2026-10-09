// type-assert.ts — compile-time assertions for the TS track.
//
//   type _1 = Expect<Equal<MyPartial<{ a: 1 }>, { a?: 1 }>>;
//
// When the types are wrong, tsc reports an error on that line — red type
// errors are the "todo list" of a TS exercise. `Equal` is the standard
// strict-equality trick (distinguishes any, never, readonly, optional).

export type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2)
    ? true
    : false;

export type NotEqual<X, Y> = Equal<X, Y> extends true ? false : true;

export type Expect<T extends true> = T;
export type ExpectFalse<T extends false> = T;

export type IsAny<T> = 0 extends 1 & T ? true : false;
export type IsNever<T> = [T] extends [never] ? true : false;
export type IsUnknown<T> =
  IsAny<T> extends true ? false : unknown extends T ? true : false;

// Value-level no-op so type-only test functions can be "used":
//   function _typeTests() { ... }
//   use(_typeTests);
export function use(..._values: unknown[]): void {}
