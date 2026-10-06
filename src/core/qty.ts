export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Snap a requested quantity to the product's step and minimum. Rounds up to the next valid multiple. */
export function snapQty(requested: number, qty_step: number, min_qty: number): { qty: number; adjusted: boolean } {
  const step = qty_step > 0 ? qty_step : 1;
  let n = Math.ceil(requested / step - 1e-6);
  if (n < 1) n = 1;
  let qty = round3(n * step);
  if (qty < min_qty - 1e-9) qty = round3(Math.ceil(min_qty / step - 1e-6) * step);
  return { qty, adjusted: Math.abs(qty - requested) > 1e-6 };
}
