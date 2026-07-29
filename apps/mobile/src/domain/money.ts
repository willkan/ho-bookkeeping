/** Money is always integer minor units (e.g. fen for CNY). Never use floating point. */
export type MoneyMinor = number;

export function assertMoneyMinor(value: number, label = 'amount'): MoneyMinor {
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be an integer minor unit, got ${value}`);
  }
  return value;
}

export function sumMoney(parts: readonly MoneyMinor[]): MoneyMinor {
  return parts.reduce((acc, part) => {
    assertMoneyMinor(part);
    return acc + part;
  }, 0);
}

/** Format fen as yuan string without floating arithmetic on the total. */
export function formatYuan(minor: MoneyMinor): string {
  assertMoneyMinor(minor);
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  const yuan = Math.floor(abs / 100);
  const fen = abs % 100;
  return `${sign}${yuan}.${fen.toString().padStart(2, '0')}`;
}

export function yuanToMinor(yuan: number): MoneyMinor {
  if (!Number.isFinite(yuan)) {
    throw new Error('yuan must be finite');
  }
  return Math.round(yuan * 100);
}
