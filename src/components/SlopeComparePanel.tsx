// Slope Lab: pick two lines, play them one after another, and compare
import { useMemo, useState } from 'react';
import { slopeCompareLines } from '../geometry/shapeLibrary';
import { compareLines, slopeClassLabel } from '../geometry/slopeAnalysis';
import { makeTwoLineShape } from '../app/adhocShapes';
import { useActions } from '../app/actions';
import { t, tl } from '../i18n';

export default function SlopeComparePanel() {
  const actions = useActions();
  const [aId, setAId] = useState(slopeCompareLines[4].id); // gentle slope
  const [bId, setBId] = useState(slopeCompareLines[5].id); // steep slope

  const lineA = slopeCompareLines.find((s) => s.id === aId) ?? slopeCompareLines[0];
  const lineB = slopeCompareLines.find((s) => s.id === bId) ?? slopeCompareLines[1];

  const result = useMemo(() => {
    const a1 = lineA.points[0];
    const a2 = lineA.points[1];
    const b1 = lineB.points[0];
    const b2 = lineB.points[1];
    return compareLines(a1, a2, b1, b2);
  }, [lineA, lineB]);

  const combined = useMemo(
    () =>
      makeTwoLineShape(
        `slope-cmp-${lineA.id}-${lineB.id}`,
        'Slope compare',
        [lineA.points[0], lineA.points[1]],
        [lineB.points[0], lineB.points[1]],
      ),
    [lineA, lineB],
  );

  const steeperText =
    result.steeper === 'equal'
      ? t('They are equally steep (or the same kind of line)')
      : result.steeper === 'a'
        ? tl(`Line A (${t(lineA.name)}) is steeper`, `线 A（${t(lineA.name)}）更陡`)
        : tl(`Line B (${t(lineB.name)}) is steeper`, `线 B（${t(lineB.name)}）更陡`);

  return (
    <div>
      <h2>
        <span aria-hidden="true">⛰️ </span>{t('Slope Lab')}
      </h2>
      <p className="settings-note">
        {t('Pick two lines and listen to them one after another. The steeper line changes pitch faster while moving less from side to side.')}
      </p>

      <div className="settings-row" style={{ maxWidth: 480 }}>
        <label htmlFor="cmp-line-a">{t('Line A')}</label>
        <select id="cmp-line-a" value={aId} onChange={(e) => setAId(e.target.value)}>
          {slopeCompareLines.map((s) => (
            <option key={s.id} value={s.id}>
              {t(s.name)}
            </option>
          ))}
        </select>
      </div>
      <div className="settings-row" style={{ maxWidth: 480 }}>
        <label htmlFor="cmp-line-b">{t('Line B')}</label>
        <select id="cmp-line-b" value={bId} onChange={(e) => setBId(e.target.value)}>
          {slopeCompareLines.map((s) => (
            <option key={s.id} value={s.id}>
              {t(s.name)}
            </option>
          ))}
        </select>
      </div>

      <div className="control-bar">
        <button onClick={() => actions.playAdhocShape(lineA)}>
          <span aria-hidden="true">🔊 </span>{t('Play Line A')}
        </button>
        <button onClick={() => actions.playAdhocShape(lineB)}>
          <span aria-hidden="true">🔊 </span>{t('Play Line B')}
        </button>
        <button className="primary" onClick={() => actions.playAdhocShape(combined)}>
          <span aria-hidden="true">🎶 </span>{t('Play A then B')}
        </button>
      </div>

      <dl className="compare-result" aria-label={t('Slope comparison results')}>
        <dt>{t('Line A')} ({t(lineA.name)})</dt>
        <dd>
          {t(slopeClassLabel(result.aClass))}
          {result.aSlope !== null ? tl(`, slope about ${result.aSlope.toFixed(2)}`, `，斜率约 ${result.aSlope.toFixed(2)}`) : ''}
        </dd>
        <dt>{t('Line B')} ({t(lineB.name)})</dt>
        <dd>
          {t(slopeClassLabel(result.bClass))}
          {result.bSlope !== null ? tl(`, slope about ${result.bSlope.toFixed(2)}`, `，斜率约 ${result.bSlope.toFixed(2)}`) : ''}
        </dd>
        <dt>{t('Which is steeper?')}</dt>
        <dd>{steeperText}</dd>
        <dt>{t('Parallel?')}</dt>
        <dd>{result.parallel ? t('Yes — they never meet') : t('No, they are not parallel')}</dd>
        <dt>{t('Perpendicular?')}</dt>
        <dd>{result.perpendicular ? t('Yes — they make a square corner') : t('No, they are not perpendicular')}</dd>
      </dl>
    </div>
  );
}
