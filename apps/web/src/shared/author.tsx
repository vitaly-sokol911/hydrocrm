import { ArrowRightOutlined } from '@ant-design/icons';
import type { CSSProperties } from 'react';

/**
 * Ссылка на разработчика для портфолио. Имя и адрес задаются при сборке:
 * VITE_AUTHOR_NAME="Иван Иванов" VITE_AUTHOR_URL="https://example.ru/#contact".
 * Если не заданы — ничего не показывается.
 */
export const AUTHOR = {
  name: import.meta.env.VITE_AUTHOR_NAME as string | undefined,
  url: import.meta.env.VITE_AUTHOR_URL as string | undefined,
};

const safeUrl = (u?: string) => (u && /^https:\/\//i.test(u) ? u : undefined);

export function AuthorLink({ style, compact }: { style?: CSSProperties; compact?: boolean }) {
  const url = safeUrl(AUTHOR.url);
  if (!AUTHOR.name || !url) return null;
  return (
    <a className={`author-link ${compact ? 'compact' : ''}`} href={url} target="_blank" rel="noopener noreferrer" style={style}>
      <span className="muted">Разработка — {AUTHOR.name}</span>
      <span>
        Обсудить похожий проект <ArrowRightOutlined />
      </span>
    </a>
  );
}
