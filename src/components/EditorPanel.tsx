// Teacher editor: draw custom shapes on the grid — click to add, drag to move, import/export
import { useCallback, useMemo, useRef, useState } from 'react';
import type { GeometryPoint, GeometryShape, PlaybackDirection } from '../geometry/geometryTypes';
import { findIntersections } from '../geometry/intersections';
import { validateShapeData } from '../geometry/shapeValidation';
import { extractRawPaths } from '../geometry/traversal';
import { useActions } from '../app/actions';
import { useStore } from '../state/store';
import { GridLines, S, toSvgX, toSvgY } from './GridDefs';
import { t, tl } from '../i18n';
import { fromUnits, speakUnits, toUnits } from '../app/describe';

interface EditorPath {
  pointIds: string[];
  closed: boolean;
}

let editorUid = 0;
const nextPointId = () => `ep-${Date.now().toString(36)}-${++editorUid}`;

export default function EditorPanel() {
  const actions = useActions();
  const { state, dispatch } = useStore();

  const shapeIdRef = useRef(`custom-${Date.now().toString(36)}`);
  const [points, setPoints] = useState<Record<string, GeometryPoint>>({});
  const [paths, setPaths] = useState<EditorPath[]>([{ pointIds: [], closed: false }]);
  const [currentPath, setCurrentPath] = useState(0);
  const [name, setName] = useState('My Shape');
  const [direction, setDirection] = useState<PlaybackDirection>('forward');
  const [startPointId, setStartPointId] = useState<string | undefined>(undefined);
  const [settingStart, setSettingStart] = useState(false);
  const [snapGrid, setSnapGrid] = useState(true);
  const [importText, setImportText] = useState('');
  const [newX, setNewX] = useState(0.5);
  const [newY, setNewY] = useState(0.5);
  const draggingRef = useRef<string | null>(null);
  const draggedRef = useRef(false);
  const svgRef = useRef<SVGSVGElement>(null);

  // Derive a GeometryShape from the editor state
  const shape: GeometryShape = useMemo(() => {
    const pts = Object.values(points);
    const segments: GeometryShape['segments'] = [];
    let order = 0;
    for (const path of paths) {
      for (let i = 0; i < path.pointIds.length - 1; i++) {
        segments.push({
          id: `es-${order}`,
          startPointId: path.pointIds[i],
          endPointId: path.pointIds[i + 1],
          order: order++,
        });
      }
      if (path.closed && path.pointIds.length >= 3) {
        segments.push({
          id: `es-${order}`,
          startPointId: path.pointIds[path.pointIds.length - 1],
          endPointId: path.pointIds[0],
          order: order++,
        });
      }
    }
    return {
      id: shapeIdRef.current,
      name,
      type: 'custom',
      points: pts,
      segments,
      closed: paths.some((p) => p.closed),
      startPointId,
      playbackDirection: direction,
    };
  }, [points, paths, name, direction, startPointId]);

  const intersections = useMemo(() => findIntersections(shape), [shape]);

  const svgCoords = useCallback(
    (e: { clientX: number; clientY: number }): { x: number; y: number } | null => {
      const svg = svgRef.current;
      if (!svg) return null;
      const rect = svg.getBoundingClientRect();
      let x = (e.clientX - rect.left) / rect.width;
      let y = 1 - (e.clientY - rect.top) / rect.height;
      x = Math.max(0, Math.min(1, x));
      y = Math.max(0, Math.min(1, y));
      if (snapGrid) {
        x = Math.round(x * 20) / 20;
        y = Math.round(y * 20) / 20;
      }
      return { x, y };
    },
    [snapGrid],
  );

  const addPoint = useCallback(
    (x: number, y: number) => {
      const id = nextPointId();
      setPoints((prev) => ({ ...prev, [id]: { id, x, y } }));
      setPaths((prev) =>
        prev.map((p, i) => (i === currentPath ? { ...p, pointIds: [...p.pointIds, id] } : p)),
      );
      actions.announce(tl(`Point added at x ${speakUnits(x)}, y ${speakUnits(y)}`, `已添加顶点 x ${speakUnits(x)}、y ${speakUnits(y)}`));
    },
    [currentPath, actions],
  );

  const onSvgClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (draggedRef.current) {
        draggedRef.current = false;
        return;
      }
      const target = e.target as Element;
      if (target.closest('[data-point-id]')) return; // clicks on points are handled there
      const c = svgCoords(e);
      if (c) addPoint(c.x, c.y);
    },
    [svgCoords, addPoint],
  );

  const onVertexPointerDown = useCallback(
    (e: React.PointerEvent, pid: string) => {
      if (settingStart) {
        setStartPointId(pid);
        setSettingStart(false);
        actions.announce(t('Start point set'));
        return;
      }
      draggingRef.current = pid;
      draggedRef.current = false;
      (e.target as Element).setPointerCapture?.(e.pointerId);
    },
    [settingStart, actions],
  );

  const onSvgPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const pid = draggingRef.current;
      if (!pid) return;
      draggedRef.current = true;
      const c = svgCoords(e);
      if (c) {
        setPoints((prev) => ({ ...prev, [pid]: { ...prev[pid], x: c.x, y: c.y } }));
      }
    },
    [svgCoords],
  );

  const onSvgPointerUp = useCallback(() => {
    draggingRef.current = null;
  }, []);

  const removeLastPoint = useCallback(() => {
    const path = paths[currentPath];
    if (!path || path.pointIds.length === 0) {
      actions.announce(t('This line has no points yet'));
      return;
    }
    const removed = path.pointIds[path.pointIds.length - 1];
    setPaths((prev) =>
      prev.map((p, i) =>
        i === currentPath ? { ...p, pointIds: p.pointIds.slice(0, -1) } : p,
      ),
    );
    setPoints((prev) => {
      const next = { ...prev };
      delete next[removed];
      return next;
    });
    if (startPointId === removed) setStartPointId(undefined);
    actions.announce(t('Last point removed'));
  }, [paths, currentPath, startPointId, actions]);

  const removePointById = useCallback(
    (pid: string) => {
      setPaths((prev) => prev.map((p) => ({ ...p, pointIds: p.pointIds.filter((id) => id !== pid) })));
      setPoints((prev) => {
        const next = { ...prev };
        delete next[pid];
        return next;
      });
      if (startPointId === pid) setStartPointId(undefined);
    },
    [startPointId],
  );

  const clearAll = useCallback(() => {
    setPoints({});
    setPaths([{ pointIds: [], closed: false }]);
    setCurrentPath(0);
    setStartPointId(undefined);
    actions.announce(t('Canvas cleared'));
  }, [actions]);

  const newPath = useCallback(() => {
    setPaths((prev) => [...prev, { pointIds: [], closed: false }]);
    setCurrentPath(paths.length);
    actions.announce(tl(`Started separate line ${paths.length + 1}`, `开始第 ${paths.length + 1} 条独立线路`));
  }, [paths.length, actions]);

  const loadShapeIntoEditor = useCallback(
    (s: GeometryShape) => {
      const pts: Record<string, GeometryPoint> = {};
      for (const p of s.points) pts[p.id] = { ...p };
      const raw = extractRawPaths(s);
      setPoints(pts);
      setPaths(
        raw.length > 0
          ? raw.map((r) => ({ pointIds: [...r.pointIds], closed: r.closed }))
          : [{ pointIds: s.points.map((p) => p.id), closed: false }],
      );
      setCurrentPath(0);
      setName(s.name);
      setDirection(s.playbackDirection);
      setStartPointId(s.startPointId);
      shapeIdRef.current = s.id;
    },
    [],
  );

  const doImport = useCallback(() => {
    let data: unknown;
    try {
      data = JSON.parse(importText);
    } catch {
      dispatch({ type: 'error', message: t('Could not parse the JSON — please check the format') });
      return;
    }
    const result = validateShapeData(data);
    if (!result.ok || !result.shape) {
      dispatch({ type: 'error', message: `${t('Invalid shape data:')} ${result.errors.join('; ')}` });
      return;
    }
    loadShapeIntoEditor(result.shape);
    actions.announce(tl(`Shape imported: ${result.shape.name}`, `已导入图形：${result.shape.name}`));
  }, [importText, dispatch, loadShapeIntoEditor, actions]);

  const exportJson = useMemo(() => JSON.stringify(shape, null, 2), [shape]);

  const downloadJson = useCallback(() => {
    try {
      const blob = new Blob([exportJson], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name || 'shape'}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (err) {
      console.error(err);
      dispatch({ type: 'error', message: t('Could not export the file') });
    }
  }, [exportJson, name, dispatch]);

  const canPlay = shape.segments.length > 0 || shape.points.length > 0;
  const path = paths[currentPath];

  return (
    <div className="editor-layout">
      <div>
        <h2>
          <span aria-hidden="true">✏️ </span>{t('Teacher Editor')}
        </h2>
        <p className="settings-note">
          {t('Click an empty spot on the grid to add a point — neighbouring points connect automatically. Drag a point to move it.')}
          {settingStart ? ` ${t('Setting the start point: click one of the points.')}` : ''}
        </p>
        <svg
          ref={svgRef}
          className="canvas-svg"
          viewBox={`0 0 ${S} ${S}`}
          role="application"
          aria-label={tl(`Custom shape canvas: ${shape.points.length} points, ${shape.segments.length} segments`, `自定义图形画布：${shape.points.length} 个顶点，${shape.segments.length} 条线段`)}
          onClick={onSvgClick}
          onPointerMove={onSvgPointerMove}
          onPointerUp={onSvgPointerUp}
        >
          <GridLines />
          <g>
            {shape.segments.map((seg) => {
              const a = points[seg.startPointId];
              const b = points[seg.endPointId];
              if (!a || !b) return null;
              return (
                <line
                  key={seg.id}
                  x1={toSvgX(a.x)}
                  y1={toSvgY(a.y)}
                  x2={toSvgX(b.x)}
                  y2={toSvgY(b.y)}
                  stroke="var(--shape-line)"
                  strokeWidth={state.lineWidth * 0.35}
                  strokeLinecap="round"
                />
              );
            })}
          </g>
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
          <g>
            {Object.values(points).map((p) => (
              <circle
                key={p.id}
                data-point-id={p.id}
                cx={toSvgX(p.x)}
                cy={toSvgY(p.y)}
                r={2.2}
                fill={p.id === startPointId ? 'var(--dot-fill)' : 'var(--vertex-fill)'}
                stroke="var(--bg-panel)"
                strokeWidth={0.5}
                style={{ cursor: 'grab' }}
                onPointerDown={(e) => onVertexPointerDown(e, p.id)}
              />
            ))}
          </g>
        </svg>
      </div>

      <div className="editor-controls">
        <label htmlFor="editor-name">
          {t('Shape name')}
          <input id="editor-name" value={name} onChange={(e) => setName(e.target.value)} />
        </label>

        <div>
          <button onClick={() => actions.playAdhocShape(shape)} disabled={!canPlay}>
            <span aria-hidden="true">🔊 </span>{t('Preview Sound')}
          </button>{' '}
          <button
            onClick={() => {
              if (shape.points.length === 0) {
                dispatch({ type: 'error', message: t('Add at least one point before saving') });
                return;
              }
              actions.saveCustomShape(shape);
            }}
          >
            <span aria-hidden="true">💾 </span>{t('Save to Library')}
          </button>
        </div>

        <div>
          <button onClick={removeLastPoint}>{t('Undo Last Point')}</button>{' '}
          <button onClick={clearAll}>{t('Clear All')}</button>{' '}
          <button onClick={newPath}>{t('New Separate Line')}</button>
        </div>

        <div className="settings-row">
          <label htmlFor="editor-path">{t('Current line')}</label>
          <select
            id="editor-path"
            value={currentPath}
            onChange={(e) => setCurrentPath(Number(e.target.value))}
          >
            {paths.map((p, i) => (
              <option key={i} value={i}>
                {tl(`Line ${i + 1} (${p.pointIds.length} points)`, `线路 ${i + 1}（${p.pointIds.length} 个顶点）`)}
              </option>
            ))}
          </select>
        </div>

        <div className="settings-row">
          <label htmlFor="editor-closed">{t('Close this line')}</label>
          <input
            id="editor-closed"
            type="checkbox"
            checked={path?.closed ?? false}
            disabled={(path?.pointIds.length ?? 0) < 3}
            onChange={(e) =>
              setPaths((prev) =>
                prev.map((p, i) => (i === currentPath ? { ...p, closed: e.target.checked } : p)),
              )
            }
          />
        </div>

        <div className="settings-row">
          <label htmlFor="editor-direction">{t('Playback direction')}</label>
          <select
            id="editor-direction"
            value={direction}
            onChange={(e) => setDirection(e.target.value as PlaybackDirection)}
          >
            <option value="forward">{t('Drawing order')}</option>
            <option value="clockwise">{t('Clockwise')}</option>
            <option value="counterclockwise">{t('Counterclockwise')}</option>
          </select>
        </div>

        <div>
          <button onClick={() => setSettingStart((v) => !v)} aria-pressed={settingStart}>
            {settingStart ? t('Cancel start point') : t('Set start point')}
          </button>{' '}
          {startPointId && (
            <button onClick={() => setStartPointId(undefined)}>{t('Clear start point')}</button>
          )}
        </div>

        <div className="settings-row">
          <label htmlFor="editor-snap">{t('Snap to grid')}</label>
          <input
            id="editor-snap"
            type="checkbox"
            checked={snapGrid}
            onChange={(e) => setSnapGrid(e.target.checked)}
          />
        </div>

        <fieldset className="settings-group">
          <legend>{t('Add point by coordinates')}</legend>
          <div className="settings-row">
            <label htmlFor="new-x">X</label>
            <input
              id="new-x"
              type="number"
              min={-5}
              max={5}
              step={0.5}
              value={Number(toUnits(newX).toFixed(2))}
              onChange={(e) => setNewX(fromUnits(Number(e.target.value)))}
            />
            <label htmlFor="new-y">Y</label>
            <input
              id="new-y"
              type="number"
              min={-5}
              max={5}
              step={0.5}
              value={Number(toUnits(newY).toFixed(2))}
              onChange={(e) => setNewY(fromUnits(Number(e.target.value)))}
            />
          </div>
          <button
            onClick={() => addPoint(Math.max(0, Math.min(1, newX)), Math.max(0, Math.min(1, newY)))}
          >
            {t('Add Point')}
          </button>
        </fieldset>

        {path && path.pointIds.length > 0 && (
          <details open>
            <summary>{tl(`Edit point coordinates (Line ${currentPath + 1})`, `编辑顶点坐标（线路 ${currentPath + 1}）`)}</summary>
            <table className="vertex-table">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">X</th>
                  <th scope="col">Y</th>
                  <th scope="col">{t('Action')}</th>
                </tr>
              </thead>
              <tbody>
                {path.pointIds.map((pid, i) => {
                  const p = points[pid];
                  if (!p) return null;
                  return (
                    <tr key={pid}>
                      <td>{i + 1}</td>
                      <td>
                        <input
                          type="number"
                          aria-label={`Point ${i + 1} x coordinate`}
                          min={-5}
                          max={5}
                          step={0.5}
                          value={Number(toUnits(p.x).toFixed(2))}
                          onChange={(e) => {
                            const v = Math.max(0, Math.min(1, fromUnits(Number(e.target.value))));
                            setPoints((prev) => ({ ...prev, [pid]: { ...prev[pid], x: v } }));
                          }}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          aria-label={`Point ${i + 1} y coordinate`}
                          min={-5}
                          max={5}
                          step={0.5}
                          value={Number(toUnits(p.y).toFixed(2))}
                          onChange={(e) => {
                            const v = Math.max(0, Math.min(1, fromUnits(Number(e.target.value))));
                            setPoints((prev) => ({ ...prev, [pid]: { ...prev[pid], y: v } }));
                          }}
                        />
                      </td>
                      <td>
                        <button onClick={() => removePointById(pid)} aria-label={`Delete point ${i + 1}`}>
                          {t('Del')}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </details>
        )}

        <p className="settings-note">{t('Crossings found:')} {intersections.length}</p>

        <details>
          <summary>{t('Export JSON')}</summary>
          <textarea
            className="json-area"
            readOnly
            value={exportJson}
            aria-label="Exported shape JSON data"
          />
          <button onClick={downloadJson}>{t('Download JSON File')}</button>
        </details>

        <details>
          <summary>{t('Import from JSON')}</summary>
          <textarea
            className="json-area"
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            aria-label="Paste shape JSON data"
            placeholder="Paste shape JSON here"
          />
          <button onClick={doImport}>{t('Import')}</button>
        </details>

        {state.customShapes.length > 0 && (
          <details>
            <summary>{t('Manage saved shapes')} ({state.customShapes.length})</summary>
            <ul>
              {state.customShapes.map((s) => (
                <li key={s.id} style={{ marginBottom: '0.3rem' }}>
                  {s.name}{' '}
                  <button onClick={() => loadShapeIntoEditor(s)}>{t('Load')}</button>{' '}
                  <button onClick={() => actions.deleteCustomShape(s.id)}>{t('Delete')}</button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}
