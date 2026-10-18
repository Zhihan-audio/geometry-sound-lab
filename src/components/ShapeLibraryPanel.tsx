// Left panel: shape library with keyboard up/down selection
import { useCallback, useMemo, useRef } from 'react';
import { shapeCategories } from '../geometry/shapeLibrary';
import type { GeometryShape } from '../geometry/geometryTypes';
import { useStore } from '../state/store';
import { useActions } from '../app/actions';
import { shapeSummary } from '../app/describe';
import { t } from '../i18n';

export default function ShapeLibraryPanel() {
  const { state } = useStore();
  const actions = useActions();
  // 挂在整个面板上：焦点查找必须覆盖所有分组，不能只在第一组里找
  const listRef = useRef<HTMLElement>(null);

  const groups = useMemo(() => {
    const result: { id: string; name: string; emoji: string; shapes: GeometryShape[] }[] =
      shapeCategories.map((c) => ({ id: c.id, name: c.name, emoji: c.emoji, shapes: c.shapes }));
    result.push({ id: 'custom', name: 'My Shapes', emoji: '⭐', shapes: state.customShapes });
    return result;
  }, [state.customShapes]);

  const flatShapes = useMemo(() => groups.flatMap((g) => g.shapes), [groups]);

  const moveSelection = useCallback(
    (delta: number) => {
      const idx = flatShapes.findIndex((s) => s.id === state.selectedShapeId);
      const next = Math.max(0, Math.min(flatShapes.length - 1, (idx < 0 ? 0 : idx) + delta));
      const shape = flatShapes[next];
      if (shape && shape.id !== state.selectedShapeId) {
        actions.selectShape(shape.id);
        // Move focus to the newly selected option
        requestAnimationFrame(() => {
          const el = listRef.current?.querySelector<HTMLElement>(`[data-shape-id="${shape.id}"]`);
          el?.focus();
        });
      }
    },
    [flatShapes, state.selectedShapeId, actions],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          e.stopPropagation(); // arrows inside the list stay local
          moveSelection(1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          e.stopPropagation();
          moveSelection(-1);
          break;
        case 'Home':
          e.preventDefault();
          e.stopPropagation();
          moveSelection(-flatShapes.length);
          break;
        case 'End':
          e.preventDefault();
          e.stopPropagation();
          moveSelection(flatShapes.length);
          break;
        case 'Enter':
        case ' ': {
          e.preventDefault();
          const target = e.target as HTMLElement;
          // 焦点元素上的图形优先；取不到就用当前选中的图形，确保 Space 永远作用于刚听到的那个
          const id = target.dataset.shapeId ?? state.selectedShapeId ?? undefined;
          if (id) actions.selectShape(id);
          // 只有在图形播放页才顺带播放；手势演奏页由手的动作发声
          if (state.view === 'play') actions.play();
          break;
        }
      }
    },
    [moveSelection, flatShapes.length, actions, state.view, state.selectedShapeId],
  );

  const selectedShape = flatShapes.find((s) => s.id === state.selectedShapeId) ?? null;

  return (
    <nav className="panel panel-left" aria-label={t('Shape Library')} ref={listRef}>
      <h2>
        <span aria-hidden="true">🧰 </span>
        {t('Shape Library')}
      </h2>
      {groups.map((group) => (
        <div className="shape-category" key={group.id}>
          <h3>
            <span aria-hidden="true">{group.emoji} </span>
            {t(group.name)}
          </h3>
          {group.shapes.length === 0 ? (
            <p className="settings-note">
              {group.id === 'custom'
                ? t('Nothing here yet — draw your own shape in the Teacher Editor! ✨')
                : ''}
            </p>
          ) : (
            <ul
              className="shape-list"
              role="listbox"
              aria-label={group.name}
              onKeyDown={onKeyDown}
            >
              {group.shapes.map((shape) => {
                const selected = shape.id === state.selectedShapeId;
                return (
                  <li
                    key={shape.id}
                    role="option"
                    aria-selected={selected}
                    aria-label={shapeSummary(shape)}
                    tabIndex={selected || (!selectedShape && shape === flatShapes[0]) ? 0 : -1}
                    data-shape-id={shape.id}
                    onClick={() => actions.selectShape(shape.id)}
                  >
                    {t(shape.name)}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ))}
      {selectedShape && (
        <div className="selected-shape-info">
          <strong>{t('Now exploring:')} </strong>
          {shapeSummary(selectedShape)}
          {selectedShape.description ? ` ${t(selectedShape.description)}` : ''}
        </div>
      )}
    </nav>
  );
}
