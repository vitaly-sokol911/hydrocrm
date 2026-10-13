import dayjs from 'dayjs';
import 'dayjs/locale/ru';
import relativeTime from 'dayjs/plugin/relativeTime';
import isToday from 'dayjs/plugin/isToday';
import isTomorrow from 'dayjs/plugin/isTomorrow';
import isYesterday from 'dayjs/plugin/isYesterday';

dayjs.extend(relativeTime);
dayjs.extend(isToday);
dayjs.extend(isTomorrow);
dayjs.extend(isYesterday);
dayjs.locale('ru');

export { dayjs };

export const fmtDate = (d: string | Date | null | undefined) => (d ? dayjs(d).format('DD.MM.YYYY') : '—');
export const fmtDateTime = (d: string | Date | null | undefined) => (d ? dayjs(d).format('DD.MM.YYYY HH:mm') : '—');
export const fmtTime = (d: string | Date | null | undefined) => (d ? dayjs(d).format('HH:mm') : '');

/** «сегодня 14:30», «вчера 09:10», «12 окт 11:00» */
export function fmtSmart(d: string | Date | null | undefined) {
  if (!d) return '—';
  const x = dayjs(d);
  if (x.isToday()) return `сегодня ${x.format('HH:mm')}`;
  if (x.isYesterday()) return `вчера ${x.format('HH:mm')}`;
  if (x.isTomorrow()) return `завтра ${x.format('HH:mm')}`;
  return x.year() === dayjs().year() ? x.format('D MMM HH:mm') : x.format('D MMM YYYY');
}

export const fromNow = (d: string | Date) => dayjs(d).fromNow();

/** 30 ч → «1 д 6 ч» */
export function fmtHours(h: number) {
  if (h < 1) return 'меньше часа';
  if (h < 24) return `${Math.round(h)} ч`;
  const days = Math.floor(h / 24);
  const rest = Math.round(h % 24);
  return rest ? `${days} д ${rest} ч` : `${days} д`;
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();

const AVATAR_COLORS = ['#1f5fbf', '#13a8a8', '#7c4dff', '#d4380d', '#389e0d', '#c41d7f', '#d48806', '#08979c'];
export const avatarColor = (id: string) => AVATAR_COLORS[[...id].reduce((s, c) => s + c.charCodeAt(0), 0) % AVATAR_COLORS.length];
