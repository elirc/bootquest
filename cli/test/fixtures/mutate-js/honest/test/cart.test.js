import { describe, expect, it } from 'vitest';
import { discount, lineTotal, shipping, subtotal } from '../src/cart.js';

describe('cart', () => {
  it('prices a line', () => {
    expect(lineTotal({ price: 2.5, qty: 4 })).toBe(10);
    expect(lineTotal({ price: 3, qty: 0 })).toBe(0);
  });
  it('rejects bad lines', () => {
    expect(() => lineTotal(null)).toThrow(TypeError);
    expect(() => lineTotal({ price: '1', qty: 1 })).toThrow(TypeError);
    expect(() => lineTotal({ price: 1, qty: '1' })).toThrow(TypeError);
    expect(() => lineTotal({ price: 1, qty: -1 })).toThrow(RangeError);
  });
  it('sums lines', () => {
    expect(subtotal([])).toBe(0);
    expect(subtotal([{ price: 1, qty: 2 }, { price: 3, qty: 1 }])).toBe(5);
  });
  it('applies discount codes', () => {
    expect(discount(80, 'HALF')).toBe(40);
    expect(discount(50, 'TENOFF')).toBe(40);
    expect(discount(49, 'TENOFF')).toBe(49);
    expect(discount(80, 'NOPE')).toBe(80);
  });
  it('charges shipping under 100', () => {
    expect(shipping(0)).toBe(0);
    expect(shipping(99.99)).toBe(7.5);
    expect(shipping(100)).toBe(0);
    expect(shipping(1)).toBe(7.5);
  });
});
