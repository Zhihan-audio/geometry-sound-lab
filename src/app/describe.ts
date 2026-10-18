// Friendly text descriptions for the UI and screen readers (bilingual)
import type { GeometryShape } from '../geometry/geometryTypes';
import type { TraversalLeg } from '../geometry/traversal';
import { shapeStats } from '../geometry/traversal';
import { classifySlope, segmentLength, slopeClassLabel } from '../geometry/slopeAnalysis';
import { getLocale, t } from '../i18n';
import { speech } from './speech';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function midiToNoteName(midi: number): string {
  const rounded = Math.round(midi);
  const name = NOTE_NAMES[((rounded % 12) + 12) % 12];
  const octave = Math.floor(rounded / 12) - 1;
  return `${name}${octave}`;
}

export function shapeSummary(shape: GeometryShape): string {
  const stats = shapeStats(shape);
  const name = t(shape.name);
  const zh = getLocale() === 'zh';

  if (shape.type === 'point') {
    return zh ? `${name}：一个单独的点` : `${shape.name}: a single point`;
  }
  if (shape.smooth) {
    return zh
      ? `${name}：平滑曲线，${stats.closed ? '闭合图形' : '开放图形'}`
      : `${shape.name}: a smooth curve, ${stats.closed ? 'closed shape' : 'open shape'}`;
  }
  if (zh) {
    const parts = [
      name,
      `${stats.vertexCount} 个顶点`,
      `${stats.edgeCount} 条边`,
      stats.closed ? '闭合图形' : '开放图形',
    ];
    if (stats.pathCount > 1) parts.push(`由 ${stats.pathCount} 条独立线路组成`);
    return parts.join('，');
  }
  const parts = [
    shape.name,
    `${stats.vertexCount} corner${stats.vertexCount === 1 ? '' : 's'}`,
    `${stats.edgeCount} side${stats.edgeCount === 1 ? '' : 's'}`,
    stats.closed ? 'closed shape' : 'open shape',
  ];
  if (stats.pathCount > 1) parts.push(`made of ${stats.pathCount} separate lines`);
  return parts.join(', ');
}

export interface LegDescription {
  title: string;
  direction: string;
  kind: string;
  length: string;
}

export function describeLeg(leg: TraversalLeg, index: number, total: number): LegDescription {
  const zh = getLocale() === 'zh';
  const dx = leg.to.x - leg.from.x;
  const dy = leg.to.y - leg.from.y;
  const horizontal =
    Math.abs(dx) < 1e-9 ? '' : dx > 0 ? (zh ? '向右' : 'to the right') : zh ? '向左' : 'to the left';
  const vertical =
    Math.abs(dy) < 1e-9 ? '' : dy > 0 ? (zh ? '向上' : 'upward') : zh ? '向下' : 'downward';
  let direction: string;
  if (horizontal && vertical) {
    direction = zh ? `${horizontal}${vertical}` : `${horizontal} and ${vertical}`;
  } else {
    direction = horizontal || vertical || (zh ? '原地' : 'staying in place');
  }
  const cls = classifySlope(leg.from, leg.to);
  const length = segmentLength(leg.from, leg.to);
  return {
    title: zh ? `第 ${index + 1} 条边，共 ${total} 条` : `Edge ${index + 1} of ${total}`,
    direction,
    kind: t(slopeClassLabel(cls)),
    length: length.toFixed(2),
  };
}

// ---------- 以中心为原点的显示坐标系 ----------
// 内部仍使用 0..1 归一化坐标；界面显示与语音播报统一换算为
// “中心为原点”的网格单位（-5..+5，右正左负、上正下负）。

/** 内部坐标 0..1 → 中心原点网格单位（-5..+5） */
export function toUnits(v: number): number {
  return v * 10 - 5;
}

/** 中心原点网格单位 → 内部坐标 0..1 */
export function fromUnits(u: number): number {
  return (u + 5) / 10;
}

/** 视觉显示：整数不带小数位，否则保留一位小数（-5、-1.8、3） */
export function formatUnits(v: number): string {
  const r = Math.round(toUnits(v) * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** 语音播报：负号读成“负 / negative”，避免连字符被语音引擎吞掉 */
export function speakUnits(v: number): string {
  const s = formatUnits(v);
  if (!s.startsWith('-')) return s;
  return getLocale() === 'zh' ? `负${s.slice(1)}` : `negative ${s.slice(1)}`;
}

/** 所在网格格子的单位坐标（向下取整，-5..4），用于按格播报 */
export function gridCellUnits(v: number): number {
  return Math.max(-5, Math.min(4, Math.floor(toUnits(v) + 1e-9)));
}

/** 带符号整数的语音形式 */
export function speakSignedInt(n: number): string {
  if (n >= 0) return String(n);
  return getLocale() === 'zh' ? `负${-n}` : `negative ${-n}`;
}

export function positionText(x: number, y: number): string {
  const zh = getLocale() === 'zh';
  if (zh) {
    const hz = x < 0.34 ? '左侧' : x > 0.66 ? '右侧' : '中间';
    const vt = y < 0.34 ? '低处' : y > 0.66 ? '高处' : '中等高度';
    return `${hz}，${vt}，坐标 x ${speakUnits(x)}、y ${speakUnits(y)}`;
  }
  const hz = x < 0.34 ? 'on the left' : x > 0.66 ? 'on the right' : 'in the middle';
  const vt = y < 0.34 ? 'low' : y > 0.66 ? 'high' : 'middle height';
  return `${hz}, ${vt}, at x ${speakUnits(x)}, y ${speakUnits(y)}`;
}

/** Optional spoken hints — routed through the central natural-voice service */
export function speak(text: string, enabled: boolean): void {
  if (!enabled) return;
  void speech.speak(text);
}
