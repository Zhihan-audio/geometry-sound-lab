// 提示音引擎：起点、终点、顶点、交点、闭合、错误、答题对错
import type { AudioEngine } from './AudioEngine';

export type CueType =
  | 'start'
  | 'end'
  | 'vertex'
  | 'intersection'
  | 'closure'
  | 'error'
  | 'correct'
  | 'wrong';

export const CUE_LABELS: Record<CueType, string> = {
  start: 'Start sound',
  end: 'Finish sound',
  vertex: 'Corner click',
  intersection: 'Crossing pulse',
  closure: 'Closing chime',
  error: 'Error sound',
  correct: 'Correct! sound',
  wrong: 'Try-again sound',
};

interface Blip {
  freq: number;
  at: number; // 秒，相对当前
  dur: number;
  type: OscillatorType;
  peak?: number;
}

export class CueSoundEngine {
  constructor(private audio: AudioEngine) {}

  play(type: CueType, pan = 0): void {
    const ctx = this.audio.ensure();
    const dest = this.audio.cueDestination;
    if (!ctx || !dest) return;

    const blips = this.designFor(type);
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    panner.connect(dest);

    const now = ctx.currentTime + 0.005;
    for (const b of blips) {
      const osc = ctx.createOscillator();
      osc.type = b.type;
      osc.frequency.value = b.freq;
      const gain = ctx.createGain();
      const peak = b.peak ?? 0.5;
      const t0 = now + b.at;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(peak, t0 + 0.008);
      gain.gain.setTargetAtTime(0.0001, t0 + b.dur * 0.55, b.dur * 0.22);
      osc.connect(gain);
      gain.connect(panner);
      osc.start(t0);
      osc.stop(t0 + b.dur + 0.25);
      osc.onended = () => {
        try {
          osc.disconnect();
          gain.disconnect();
        } catch {
          // 已断开
        }
      };
    }
  }

  // 各提示音在音区、节奏、音色三个维度同时拉开距离，方便纯听觉区分：
  // 错误(超低 87-110Hz) < 答错(中低 262-392) < 起止(440-880 八度) <
  // 交点(587 锯齿双脉冲) < 闭合(523-1047 八度琶音) < 答对(784-1568 八度跳进) < 顶点(超高 2093)
  private designFor(type: CueType): Blip[] {
    switch (type) {
      case 'start':
        // 上行纯八度：准备开始
        return [
          { freq: 440, at: 0, dur: 0.09, type: 'sine' },
          { freq: 880, at: 0.11, dur: 0.1, type: 'sine' },
        ];
      case 'end':
        // 下行纯八度：普通结束（与开始互为镜像）
        return [
          { freq: 880, at: 0, dur: 0.09, type: 'sine' },
          { freq: 440, at: 0.11, dur: 0.12, type: 'sine' },
        ];
      case 'vertex':
        // 单个短促超高音点击（全部提示音中最高）
        return [{ freq: 2093, at: 0, dur: 0.045, type: 'triangle', peak: 0.55 }];
      case 'intersection':
        // 中音区锯齿波双脉冲：音区与音色都远离顶点
        return [
          { freq: 587.33, at: 0, dur: 0.04, type: 'sawtooth', peak: 0.32 },
          { freq: 587.33, at: 0.075, dur: 0.04, type: 'sawtooth', peak: 0.32 },
        ];
      case 'closure':
        // 三音上行琶音跨整个八度：图形闭合完成
        return [
          { freq: 523.25, at: 0, dur: 0.1, type: 'sine' },
          { freq: 783.99, at: 0.1, dur: 0.1, type: 'sine' },
          { freq: 1046.5, at: 0.2, dur: 0.18, type: 'sine' },
        ];
      case 'error':
        // 超低沉双响（全部提示音中最低）
        return [
          { freq: 110, at: 0, dur: 0.14, type: 'square', peak: 0.28 },
          { freq: 87.31, at: 0.17, dur: 0.2, type: 'square', peak: 0.28 },
        ];
      case 'correct':
        // 明亮的上行八度跳进
        return [
          { freq: 783.99, at: 0, dur: 0.1, type: 'triangle' },
          { freq: 1567.98, at: 0.11, dur: 0.16, type: 'triangle' },
        ];
      case 'wrong':
        // 温和的中低音区下行纯五度
        return [
          { freq: 392, at: 0, dur: 0.12, type: 'triangle', peak: 0.4 },
          { freq: 261.63, at: 0.14, dur: 0.16, type: 'triangle', peak: 0.4 },
        ];
    }
  }
}
