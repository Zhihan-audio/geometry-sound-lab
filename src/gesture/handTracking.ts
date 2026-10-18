// Pure hand-tracking math: landmark mapping, smoothing, pinch and presence logic.
// Kept free of MediaPipe/browser APIs so it is fully unit-testable.

export interface HandPoint {
  x: number;
  y: number;
}

/**
 * Convert a MediaPipe landmark (x right, y DOWN, camera view) into app grid
 * coordinates (x right, y UP), mirroring horizontally so that moving your hand
 * to YOUR right moves the sound to the right (selfie-view mirroring).
 */
export function landmarkToGrid(lm: HandPoint): HandPoint {
  const x = 1 - lm.x;
  const y = 1 - lm.y;
  return {
    x: Math.max(0, Math.min(1, x)),
    y: Math.max(0, Math.min(1, y)),
  };
}

/** Exponential moving average smoother for a 2D point (removes camera jitter) */
export class PointSmoother {
  private current: HandPoint | null = null;

  constructor(private alpha = 0.35) {}

  push(p: HandPoint): HandPoint {
    if (!this.current) {
      this.current = { ...p };
    } else {
      this.current = {
        x: this.current.x + this.alpha * (p.x - this.current.x),
        y: this.current.y + this.alpha * (p.y - this.current.y),
      };
    }
    return { ...this.current };
  }

  reset(): void {
    this.current = null;
  }
}

/**
 * Pinch detection (thumb tip ↔ index tip) with hysteresis so the state does
 * not flicker around the threshold.
 */
export class PinchDetector {
  private pinched = false;

  constructor(
    private closeThreshold = 0.06,
    private openThreshold = 0.1,
  ) {}

  /** Returns true exactly once per new pinch (rising edge) */
  update(thumbTip: HandPoint, indexTip: HandPoint): boolean {
    const dist = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y);
    if (!this.pinched && dist < this.closeThreshold) {
      this.pinched = true;
      return true;
    }
    if (this.pinched && dist > this.openThreshold) {
      this.pinched = false;
    }
    return false;
  }

  get isPinched(): boolean {
    return this.pinched;
  }

  reset(): void {
    this.pinched = false;
  }
}

/**
 * Debounce hand presence: require several consecutive frames before switching
 * state, so brief detection dropouts do not spam "hand lost / hand found".
 */
export class PresenceDebouncer {
  private present = false;
  private streak = 0;

  constructor(private framesToSwitch = 4) {}

  /** Returns the debounced presence state after this frame */
  update(detectedThisFrame: boolean): boolean {
    if (detectedThisFrame === this.present) {
      this.streak = 0;
      return this.present;
    }
    this.streak++;
    if (this.streak >= this.framesToSwitch) {
      this.present = detectedThisFrame;
      this.streak = 0;
    }
    return this.present;
  }

  get isPresent(): boolean {
    return this.present;
  }

  reset(): void {
    this.present = false;
    this.streak = 0;
  }
}

/** MediaPipe hand landmark indices used by the tracker */
export const LANDMARK = {
  WRIST: 0,
  THUMB_TIP: 4,
  INDEX_TIP: 8,
} as const;
