// SVG 坐标网格（viewBox 0..100，y 轴翻转由调用方处理）
export const S = 100;

export function toSvgX(x: number): number {
  return x * S;
}

export function toSvgY(y: number): number {
  return (1 - y) * S;
}

export function GridLines() {
  const lines = [];
  for (let i = 0; i <= 10; i++) {
    const p = (i / 10) * S;
    const axis = i === 5;
    lines.push(
      <line
        key={`v${i}`}
        x1={p}
        y1={0}
        x2={p}
        y2={S}
        stroke={axis ? 'var(--grid-axis)' : 'var(--grid-line)'}
        strokeWidth={axis ? 0.5 : 0.25}
      />,
      <line
        key={`h${i}`}
        x1={0}
        y1={p}
        x2={S}
        y2={p}
        stroke={axis ? 'var(--grid-axis)' : 'var(--grid-line)'}
        strokeWidth={axis ? 0.5 : 0.25}
      />,
    );
  }
  return <g aria-hidden="true">{lines}</g>;
}
