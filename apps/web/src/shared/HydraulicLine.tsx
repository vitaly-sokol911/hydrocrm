import type { CSSProperties } from 'react';

export interface LineStage {
  key: string;
  name: string;
  /** Подпись под названием: дата прохождения. */
  note?: string;
}

/**
 * Фирменный элемент: этапы заказа как гидравлическая магистраль.
 * «Масло» заполняет трубу до текущего этапа, пройденные фитинги закрашены.
 * lost — заказ закрыт отказом: линия «перекрыта» красным на текущем этапе.
 */
export function HydraulicLine({
  stages,
  current,
  lost,
  animate,
}: {
  stages: LineStage[];
  current: number;
  lost?: boolean;
  animate?: boolean;
}) {
  const last = Math.max(1, stages.length - 1);
  const fill = Math.min(1, Math.max(0, current / last));
  return (
    <div
      className={`hline ${animate ? 'hline-animate' : ''} ${lost ? 'hline-lost' : ''}`}
      style={{ '--fill': fill, '--count': stages.length } as CSSProperties}
      role="img"
      aria-label={`Этап ${current + 1} из ${stages.length}: ${stages[current]?.name ?? ''}`}
    >
      <div className="hline-pipe">
        <div className="hline-oil" />
      </div>
      <ol className="hline-nodes">
        {stages.map((s, i) => (
          <li key={s.key} className={i < current ? 'passed' : i === current ? 'current' : ''}>
            <span className="hline-fitting" />
            <span className="hline-name">{s.name}</span>
            {s.note && <span className="hline-note">{s.note}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}
