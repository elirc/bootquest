// FIXTURE (W6 mutation gate): a small, well-tested module.
export function lineTotal(item) {
  if (!item || typeof item.price !== 'number' || typeof item.qty !== 'number') throw new TypeError('invalid item');
  if (item.qty < 0) throw new RangeError('qty must be >= 0');
  return item.price * item.qty;
}

export function subtotal(items) {
  return items.reduce((sum, it) => sum + lineTotal(it), 0);
}

export function discount(total, code) {
  if (code === 'HALF') return total / 2;
  if (code === 'TENOFF' && total >= 50) return total - 10;
  return total;
}

export function shipping(total) {
  if (total === 0) return 0;
  return total >= 100 ? 0 : 7.5;
}
