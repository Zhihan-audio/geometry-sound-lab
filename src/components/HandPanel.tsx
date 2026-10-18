// Hand Play: camera hand-tracking drives the sonification —
// free play (air theremin: x→pan, y→pitch) or tracing the selected shape
// through the exploration engine (line tone, corner & crossing cues).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore, resolveShape } from '../state/store';
import { useActions } from '../app/actions';
import { engineSettings, getEngine } from '../app/engine';
import { mapPosition } from '../audio/SonificationMapper';
import { formatUnits, positionText, shapeSummary } from '../app/describe';
import {
  HandTracker,
  type HandFrame,
  type HandTrackerErrorCode,
  type HandTrackerStatus,
} from '../gesture/HandTracker';
import { t, tl } from '../i18n';
import { GridLines, S, toSvgX, toSvgY } from './GridDefs';

type HandMode = 'free' | 'trace';

function errorText(code: HandTrackerErrorCode, lang: 'en' | 'zh'): string {
  const messages: Record<HandTrackerErrorCode, { en: string; zh: string }> = {
    'assets-missing': {
      en: 'hand-tracking files are missing from the app',
      zh: '应用缺少手势追踪所需的文件',
    },
    'no-permission': { en: 'camera access was not allowed', zh: '摄像头权限未被允许' },
    'no-camera': { en: 'no usable camera was found', zh: '没有找到可用的摄像头' },
    'camera-stopped': { en: 'the camera stopped unexpectedly', zh: '摄像头意外停止' },
    unknown: { en: 'hand tracking could not start', zh: '手势追踪无法启动' },
  };
  return messages[code][lang];
}

export default function HandPanel() {
  const { state } = useStore();
  const actions = useActions();
  const engine = useMemo(() => getEngine(), []);
  const tracker = useMemo(() => new HandTracker(), []);

  const [status, setStatus] = useState<HandTrackerStatus>('idle');
  const [errorCode, setErrorCode] = useState<HandTrackerErrorCode | null>(null);
  const [mode, setMode] = useState<HandMode>('free');
  const [handPos, setHandPos] = useState<{ x: number; y: number } | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const voiceOnRef = useRef(false);
  const presentRef = useRef(false);
  const modeRef = useRef<HandMode>(mode);
  const posThrottleRef = useRef(0);

  const shape = resolveShape(state);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const stopSound = useCallback(() => {
    engine.audio.stopVoice();
    engine.audio.setNoiseActive(false);
    voiceOnRef.current = false;
  }, [engine]);

  // A single frame from the tracker → sound
  const handleFrame = useCallback(
    (frame: HandFrame) => {
      // Presence transitions
      if (frame.present !== presentRef.current) {
        presentRef.current = frame.present;
        if (frame.present) {
          actions.announce(t('Hand detected'));
        } else {
          stopSound();
          setHandPos(null);
          actions.announce(t('Hand lost — hold your hand up to the camera'));
          return;
        }
      }
      if (!frame.present) return;

      // Visual pointer (throttled)
      const now = performance.now();
      if (now - posThrottleRef.current > 70) {
        posThrottleRef.current = now;
        setHandPos({ x: frame.x, y: frame.y });
      }

      if (modeRef.current === 'trace') {
        engine.exploration.moveTo(frame.x, frame.y);
      } else {
        const s = engineSettings.current;
        const m = mapPosition(frame.x, frame.y, {
          minMidi: s.minMidi,
          maxMidi: s.maxMidi,
          pitchMode: s.pitchMode,
          scale: s.selectedScale,
        });
        if (voiceOnRef.current) {
          engine.audio.updateVoice(m.frequency, m.pan);
        } else {
          engine.audio.startVoice(m.frequency, m.pan);
          voiceOnRef.current = true;
        }
      }

      if (frame.pinchStarted) {
        actions.announce(positionText(frame.x, frame.y));
      }
    },
    [engine, actions, stopSound],
  );

  // Wire tracker callbacks
  useEffect(() => {
    tracker.onFrame = handleFrame;
    tracker.onError = (code) => {
      setStatus('error');
      setErrorCode(code);
      actions.announce(tl(`Hand tracking error: ${errorText(code, 'en')}`, `手势追踪出错：${errorText(code, 'zh')}`));
    };
    return () => {
      tracker.onFrame = null;
      tracker.onError = null;
    };
  }, [tracker, handleFrame, actions]);

  // Mode transitions while running
  useEffect(() => {
    if (status !== 'running') return;
    stopSound();
    if (mode === 'trace' && shape) {
      engine.scheduler.stop();
      engine.exploration.start(shape);
    } else {
      engine.exploration.stop();
    }
  }, [mode, status, shape, engine, stopSound]);

  // Full cleanup when leaving the view
  useEffect(() => {
    return () => {
      tracker.stop();
      engine.exploration.stop();
      engine.audio.stopVoice();
      engine.audio.setNoiseActive(false);
    };
  }, [tracker, engine]);

  const startTracking = useCallback(async () => {
    if (!videoRef.current) return;
    setErrorCode(null);
    setStatus('starting');
    actions.announce(t('Starting the camera — this can take a few seconds'));
    try {
      await tracker.start(videoRef.current);
      setStatus('running');
      engine.scheduler.stop();
      if (modeRef.current === 'trace' && shape) {
        engine.exploration.start(shape);
      }
      actions.announce(t('Hand tracking is on. Hold one hand up and move it slowly.'));
    } catch {
      // onError already reported the details
    }
  }, [tracker, engine, shape, actions]);

  const changeMode = useCallback(
    (m: HandMode) => {
      setMode(m);
      actions.announce(
        m === 'trace' && shape
          ? tl(`Trace mode — tracing: ${t(shape.name)}`, `描摹模式——正在描摹：${t(shape.name)}`)
          : tl('Free play mode', '自由演奏模式'),
      );
    },
    [actions, shape],
  );

  const stopTracking = useCallback(() => {
    tracker.stop();
    engine.exploration.stop();
    stopSound();
    presentRef.current = false;
    setHandPos(null);
    setStatus('idle');
    actions.announce(t('Hand tracking stopped'));
  }, [tracker, engine, stopSound, actions]);

  // Escape stops hand tracking (the app-level handler yields Escape to this view)
  useEffect(() => {
    if (status !== 'running') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        stopTracking();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [status, stopTracking]);

  const running = status === 'running';
  const byId = shape ? new Map(shape.points.map((p) => [p.id, p])) : null;

  return (
    <div>
      <h2>
        <span aria-hidden="true">🖐️ </span>
        {t('Hand Play')}
      </h2>
      <p className="settings-note">
        {t(
          'Move your hand in front of the camera: left and right is pan, up and down is pitch — the same sound logic as everywhere else. Pinch your thumb and index finger to hear where your hand is.',
        )}
      </p>

      <div className="control-bar">
        {!running ? (
          <button className="primary" onClick={() => void startTracking()} disabled={status === 'starting'}>
            <span aria-hidden="true">📷 </span>
            {status === 'starting' ? t('Starting…') : t('Start Hand Tracking')}
          </button>
        ) : (
          <button onClick={stopTracking}>
            <span aria-hidden="true">⏹️ </span>
            {t('Stop Hand Tracking')}
          </button>
        )}
        <span role="radiogroup" aria-label={t('Hand mode')}>
          <label style={{ marginRight: '0.6rem' }}>
            <input type="radio" name="hand-mode" checked={mode === 'free'} onChange={() => changeMode('free')} />
            {t('Free play')}
          </label>
          <label>
            <input
              type="radio"
              name="hand-mode"
              checked={mode === 'trace'}
              aria-disabled={!shape}
              onClick={(e) => {
                if (!shape) {
                  e.preventDefault();
                  actions.announce(t('Please pick a shape from the library first'));
                }
              }}
              onChange={() => shape && changeMode('trace')}
            />
            {t('Trace the shape')}
          </label>
        </span>
      </div>

      {errorCode && (
        <p className="settings-note" role="alert">
          {tl('Could not start: ', '无法启动：')}
          {tl(errorText(errorCode, 'en'), errorText(errorCode, 'zh'))}{' '}
          {tl(
            'Check that the camera is connected and allowed in System Settings → Privacy & Security → Camera.',
            '请检查摄像头已连接，并在 系统设置 → 隐私与安全性 → 摄像头 中允许本程序使用。',
          )}
        </p>
      )}

      <div className="hand-layout">
        <svg
          className="canvas-svg"
          viewBox={`0 0 ${S} ${S}`}
          role="img"
          aria-label={
            mode === 'trace' && shape
              ? `${t('Hand pointer over the shape.')} ${shapeSummary(shape)}`
              : t('Hand pointer area')
          }
        >
          <GridLines />
          {mode === 'trace' && shape && byId && (
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
                    strokeWidth={state.lineWidth * 0.35}
                    strokeLinecap="round"
                  />
                );
              })}
            </g>
          )}
          {handPos && (
            <g>
              <g stroke="var(--dot-fill)" strokeWidth={0.5} opacity={0.7}>
                <line x1={toSvgX(handPos.x) - 5} y1={toSvgY(handPos.y)} x2={toSvgX(handPos.x) + 5} y2={toSvgY(handPos.y)} />
                <line x1={toSvgX(handPos.x)} y1={toSvgY(handPos.y) - 5} x2={toSvgX(handPos.x)} y2={toSvgY(handPos.y) + 5} />
              </g>
              <circle
                className="sound-dot"
                cx={toSvgX(handPos.x)}
                cy={toSvgY(handPos.y)}
                r={2.2}
                fill="var(--dot-fill)"
                stroke="var(--bg-panel)"
                strokeWidth={0.6}
              />
            </g>
          )}
        </svg>

        <div className="hand-side">
          {/* Mirrored preview so the teacher sees a natural selfie view */}
          <video ref={videoRef} className="hand-video" muted playsInline aria-hidden="true" />
          <p className="settings-note" role="status">
            {status === 'idle' && t('Camera is off')}
            {status === 'starting' && t('Starting…')}
            {status === 'error' && t('Camera error')}
            {running && (handPos ? t('Hand detected') : t('Show one hand to the camera'))}
          </p>
          {/* Rapidly-changing coordinates are a visual aid only — never announced */}
          {running && handPos && (
            <p className="settings-note" aria-hidden="true">
              {t('Hand position')}: ({formatUnits(handPos.x)}, {formatUnits(handPos.y)})
            </p>
          )}
          {mode === 'trace' && shape && (
            <p className="settings-note">
              {t('Tracing')}: {t(shape.name)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
