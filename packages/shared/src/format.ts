// Форматирование для интерфейса и документов (docs/07-интерфейс.md, ИНФ-32).

const moneyFormatter = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** 4500000 коп → «45 000 ₽» */
export function formatMoney(kop: number | bigint | null | undefined, withCurrency = true): string {
  if (kop === null || kop === undefined) return '—';
  const rub = Number(kop) / 100;
  // Intl ставит неразрывные пробелы между разрядами — заменяем обычными.
  const text = moneyFormatter.format(rub).replace(/\s/g, ' ');
  return withCurrency ? `${text} ₽` : text;
}

export function rubToKop(rub: number): number {
  return Math.round(rub * 100);
}

/** Нормализация телефона в E.164 для российских номеров: «8 (912) 345-67-89» → «+79123456789». */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  let digits = input.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 11 && digits.startsWith('8')) digits = '7' + digits.slice(1);
  if (digits.length === 10) digits = '7' + digits;
  return '+' + digits;
}

/** «+79123456789» → «+7 912 345-67-89» */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  const m = e164.match(/^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/);
  return m ? `+7 ${m[1]} ${m[2]}-${m[3]}-${m[4]}` : e164;
}

/** Проверка контрольной суммы ИНН (10 цифр — юрлицо, 12 — ИП и физлицо). */
export function isValidInn(inn: string): boolean {
  if (!/^\d{10}$|^\d{12}$/.test(inn)) return false;
  const d = inn.split('').map(Number);
  const check = (coefs: number[]) => (coefs.reduce((s, c, i) => s + c * d[i], 0) % 11) % 10;
  if (d.length === 10) return check([2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[9];
  return (
    check([7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[10] && check([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[11]
  );
}

export interface EstimateLine {
  quantity: number;
  priceKop: number;
  costKop: number;
  discountPercent: number;
  status: 'proposed' | 'approved' | 'declined';
  kind: 'work' | 'part' | 'service';
}

export interface EstimateTotals {
  worksKop: number;
  partsKop: number;
  servicesKop: number;
  subtotalKop: number;
  orderDiscountKop: number;
  totalKop: number;
  costKop: number;
  marginKop: number;
  marginPercent: number;
}

/** Итоги сметы (ЗАК-42): учитываются только позиции «В смете». */
export function calcEstimate(lines: EstimateLine[], orderDiscountPercent = 0): EstimateTotals {
  let worksKop = 0;
  let partsKop = 0;
  let servicesKop = 0;
  let costKop = 0;
  for (const l of lines) {
    if (l.status !== 'approved') continue;
    const sum = Math.round(l.quantity * l.priceKop * (1 - l.discountPercent / 100));
    if (l.kind === 'work') worksKop += sum;
    else if (l.kind === 'part') partsKop += sum;
    else servicesKop += sum;
    costKop += Math.round(l.quantity * l.costKop);
  }
  const subtotalKop = worksKop + partsKop + servicesKop;
  const orderDiscountKop = Math.round((subtotalKop * orderDiscountPercent) / 100);
  const totalKop = subtotalKop - orderDiscountKop;
  const marginKop = totalKop - costKop;
  const marginPercent = totalKop > 0 ? Math.round((marginKop / totalKop) * 1000) / 10 : 0;
  return { worksKop, partsKop, servicesKop, subtotalKop, orderDiscountKop, totalKop, costKop, marginKop, marginPercent };
}
