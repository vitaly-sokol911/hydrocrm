import { describe, expect, it } from 'vitest';
import { calcEstimate, formatMoney, formatPhone, isValidInn, normalizePhone } from './format';

describe('normalizePhone', () => {
  it('приводит российские номера к E.164', () => {
    expect(normalizePhone('8 (912) 345-67-89')).toBe('+79123456789');
    expect(normalizePhone('+7 912 345 67 89')).toBe('+79123456789');
    expect(normalizePhone('9123456789')).toBe('+79123456789');
    expect(normalizePhone('')).toBeNull();
  });
  it('форматирует обратно', () => {
    expect(formatPhone('+79123456789')).toBe('+7 912 345-67-89');
  });
});

describe('isValidInn', () => {
  it('проверяет контрольную сумму', () => {
    expect(isValidInn('7707083893')).toBe(true); // Сбербанк
    expect(isValidInn('7707083894')).toBe(false);
    expect(isValidInn('500100732259')).toBe(true);
    expect(isValidInn('12345')).toBe(false);
  });
});

describe('formatMoney', () => {
  it('копейки → рубли с разрядами', () => {
    expect(formatMoney(4_500_000)).toBe('45 000 ₽');
    expect(formatMoney(150)).toBe('1,5 ₽');
    expect(formatMoney(null)).toBe('—');
  });
});

describe('calcEstimate', () => {
  it('считает только позиции в смете, скидки и маржу', () => {
    const t = calcEstimate(
      [
        { kind: 'work', quantity: 2, priceKop: 300_000, costKop: 0, discountPercent: 0, status: 'approved' },
        { kind: 'part', quantity: 1, priceKop: 1_000_000, costKop: 600_000, discountPercent: 10, status: 'approved' },
        { kind: 'part', quantity: 1, priceKop: 999_999, costKop: 1, discountPercent: 0, status: 'proposed' },
        { kind: 'service', quantity: 1, priceKop: 200_000, costKop: 50_000, discountPercent: 0, status: 'declined' },
      ],
      5,
    );
    expect(t.worksKop).toBe(600_000);
    expect(t.partsKop).toBe(900_000);
    expect(t.servicesKop).toBe(0);
    expect(t.subtotalKop).toBe(1_500_000);
    expect(t.orderDiscountKop).toBe(75_000);
    expect(t.totalKop).toBe(1_425_000);
    expect(t.costKop).toBe(600_000);
    expect(t.marginKop).toBe(825_000);
    expect(t.marginPercent).toBe(57.9);
  });
});
