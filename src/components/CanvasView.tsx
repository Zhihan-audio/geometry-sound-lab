// Center canvas: SVG grid, shape, corners, crossings, sound dot and exploration pointer
import { useCallback, useMemo, useRef } from 'react';
import { useStore, resolveShape } from '../state/store';
import { buildTraversal } from '../geometry/traversal';
import { findIntersections } from '../geometry/intersections';
import { gridCellUnits, shapeSummary, speakSignedInt } from '../app/describe';
import { speech } from '../app/speech';
import { t, tl } from '../i18n';
import { GridLines, S, toSvgX, toSvgY } from './GridDefs';

export default function CanvasView() {
  const { state } = useStore();
  const shape = resolveShape(state);
  const mouseCellRef = useRef<string | null>(null);

  // 鼠标在坐标系里每跨过一条网格线（0.1）就语音播报一次当前坐标
  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));
      const cx = gridCellUnits(x);
      const cy = gridCellUnits(y);
      const key = `${cx},${cy}`;
      if (mouseCellRef.current === key) return;
      mouseCellRef.current = key;
      if (state.speechEnabled && !state.tutorialActive && !state.welcomeOpen) {
        void speech.speak(`${speakSignedInt(cx)}, ${speakSignedInt(cy)}`);
      }
    },
    [state.speechEnabled, state.tutorialActive, state.welcomeOpen],
  );

  const onPointerLeave = useCallback(() => {
    mouseCellRef.current = null;
  }, []);

  const plan = useMemo(() => {
    if (!shape) return null;
    try {
      return buildTraversal(shape, { direction: state.playDirection });
    } catch {
      return null;
    }
  }, [shape, state.playDirection]);

  const intersections = useMemo(() => (shape ? findIntersections(shape) : []), [shape]);

  if (!shape) {
    return <p>{t('Pick a shape from the library on the left to get started!')}</p>;
  }

  if (state.hideVisuals) {
    return (
      <div className="canvas-wrap">
        <div className="hidden-visual-note" role="note">
          {t('The visual display is hidden (turn it back on in Display settings).')}
          <br />
          {t('Current shape:')} {shapeSummary(shape)}
        </div>
      </div>
    );
  }

  const lw = state.lineWidth * 0.35;
  const byId = new Map(shape.points.map((p) => [p.id, p]));
  const startPoint = plan && plan.legs.length > 0 ? plan.legs[0].from : null;
  const firstLeg = plan && plan.legs.length > 0 ? plan.legs[0] : null;

  // Direction arrow drawn 40% along the first leg
  let arrow: { x: number; y: number; angle: number } | null = null;
  if (firstLeg) {
    const mx = firstLeg.from.x + (firstLeg.to.x - firstLeg.from.x) * 0.4;
    const my = firstLeg.from.y + (firstLeg.to.y - firstLeg.from.y) * 0.4;
    const angle =
      (Math.atan2(-(firstLeg.to.y - firstLeg.from.y), firstLeg.to.x - firstLeg.from.x) * 180) /
      Math.PI;
    arrow = { x: toSvgX(mx), y: toSvgY(my), angle };
  }

  const pos = state.playbackMode === 'exploration' ? state.explorationPos : state.currentPosition;

  return (
    <div className="canvas-wrap">
      <svg
        className="canvas-svg"
        viewBox={`0 0 ${S} ${S}`}
        role="img"
        aria-label={`${t('Shape display.')} ${shapeSummary(shape)}`}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
      >
        <GridLines />
        {/* Shape segments */}
        <g>
          {shape.segments.map((seg) => {
            const a = byId.get(seg.startPointId);
            const b = byId.get(seg.endPointId);
            if (!a || !b) return null;
            return (
              <line
                key={seg.id}
                x1={toSvgX(a.x)}
                y1={toSvgY(a.y)}
                x2={toSvgX(b.x)}
                y2={toSvgY(b.y)}
                stroke="var(--shape-line)"
                strokeWidth={lw}
                strokeLinecap="round"
              />
            );
          })}
        </g>
        {/* Corners (curve sample points are not shown) */}
        <g>
          {shape.points
            .filter((p) => p.cue !== false)
            .map((p) => (
              <circle
                key={p.id}
                cx={toSvgX(p.x)}
                cy={toSvgY(p.y)}
                r={1.6}
                fill="var(--vertex-fill)"
              />
            ))}
        </g>
        {/* Start marker: square outline, distinct from round corners */}
        {startPoint && (
          <rect
            x={toSvgX(startPoint.x) - 2.6}
            y={toSvgY(startPoint.y) - 2.6}
            width={5.2}
            height={5.2}
            fill="none"
            stroke="var(--vertex-fill)"
            strokeWidth={0.7}
          />
        )}
        {/* Playback direction arrow */}
        {arrow && (
          <polygon
            points="0,-2.2 4.4,0 0,2.2"
            transform={`translate(${arrow.x} ${arrow.y}) rotate(${arrow.angle})`}
            fill="var(--vertex-fill)"
          />
        )}
        {/* Crossings: diamond markers */}
        <g>
          {intersections.map((ip, i) => (
            <rect
              key={i}
              x={-2}
              y={-2}
              width={4}
              height={4}
              transform={`translate(${toSvgX(ip.x)} ${toSvgY(ip.y)}) rotate(45)`}
              fill="none"
              stroke="var(--intersection)"
              strokeWidth={0.8}
            />
          ))}
        </g>
        {/* Sound dot / exploration pointer */}
        {pos && (
          <g>
            {state.playbackMode === 'exploration' && (
              <g stroke="var(--dot-fill)" strokeWidth={0.5} opacity={0.7}>
                <line x1={toSvgX(pos.x) - 5} y1={toSvgY(pos.y)} x2={toSvgX(pos.x) + 5} y2={toSvgY(pos.y)} />
                <line x1={toSvgX(pos.x)} y1={toSvgY(pos.y) - 5} x2={toSvgX(pos.x)} y2={toSvgY(pos.y) + 5} />
              </g>
            )}
            <circle
              className="sound-dot"
              cx={toSvgX(pos.x)}
              cy={toSvgY(pos.y)}
              r={state.playbackMode === 'exploration' && !state.explorationOnLine ? 1.4 : 2.2}
              fill="var(--dot-fill)"
              stroke="var(--bg-panel)"
              strokeWidth={0.6}
            />
          </g>
        )}
      </svg>
      <div className="sr-only" aria-hidden="false">
        {shapeSummary(shape)}
        {intersections.length > 0
          ? tl(
              `, with ${intersections.length} crossing point${intersections.length === 1 ? '' : 's'}`,
              `，包含 ${intersections.length} 个交点`,
            )
          : ''}
      </div>
    </div>
  );
}
