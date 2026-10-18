// MediaPipe hand-tracking wrapper: camera + landmarker lifecycle, emits
// smoothed grid-coordinate frames. All heavy assets load locally (offline).
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import {
  landmarkToGrid,
  LANDMARK,
  PinchDetector,
  PointSmoother,
  PresenceDebouncer,
} from './handTracking';

type Fileset = Parameters<typeof HandLandmarker.createFromOptions>[0];

declare global {
  interface Window {
    nativeBridge?: {
      readAsset(relPath: string): Promise<Uint8Array | null>;
      requestCamera(): Promise<boolean>;
    };
  }
}

export interface HandFrame {
  present: boolean;
  x: number;
  y: number;
  pinchStarted: boolean;
}

export type HandTrackerStatus = 'idle' | 'starting' | 'running' | 'error';

export type HandTrackerErrorCode =
  | 'assets-missing'
  | 'no-permission'
  | 'no-camera'
  | 'camera-stopped'
  | 'unknown';

export class HandTrackerError extends Error {
  constructor(readonly code: HandTrackerErrorCode) {
    super(code);
    this.name = 'HandTrackerError';
  }
}

function classifyError(err: unknown): HandTrackerErrorCode {
  if (err instanceof HandTrackerError) return err.code;
  if (err instanceof DOMException) {
    if (err.name === 'NotAllowedError' || err.name === 'SecurityError') return 'no-permission';
    if (
      err.name === 'NotFoundError' ||
      err.name === 'OverconstrainedError' ||
      err.name === 'NotReadableError'
    ) {
      return 'no-camera';
    }
  }
  return 'unknown';
}

const WASM_LOADER = 'mediapipe/wasm/vision_wasm_internal.js';
const WASM_BINARY = 'mediapipe/wasm/vision_wasm_internal.wasm';
const MODEL_PATH = 'models/hand_landmarker.task';

export class HandTracker {
  private landmarker: HandLandmarker | null = null;
  private video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private raf = 0;
  private smoother = new PointSmoother(0.35);
  private pinch = new PinchDetector();
  private presence = new PresenceDebouncer(4);
  private lastVideoTime = -1;
  private lastPos = { x: 0.5, y: 0.5 };
  private blobUrls: string[] = [];
  /** Cancellation token: stop() and every start() bump it; awaited work re-checks it */
  private epoch = 0;

  status: HandTrackerStatus = 'idle';
  onFrame: ((frame: HandFrame) => void) | null = null;
  onError: ((code: HandTrackerErrorCode) => void) | null = null;

  /** Load wasm + model — via HTTP in dev, via the IPC bridge under file:// */
  private async createLandmarker(): Promise<HandLandmarker> {
    const isFileProtocol = typeof location !== 'undefined' && location.protocol === 'file:';

    if (isFileProtocol && window.nativeBridge) {
      const [loaderBytes, wasmBytes, modelBytes] = await Promise.all([
        window.nativeBridge.readAsset(WASM_LOADER),
        window.nativeBridge.readAsset(WASM_BINARY),
        window.nativeBridge.readAsset(MODEL_PATH),
      ]);
      if (!loaderBytes || !wasmBytes || !modelBytes) {
        throw new HandTrackerError('assets-missing');
      }
      const blobUrl = (bytes: Uint8Array, type: string) => {
        const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
        this.blobUrls.push(url);
        return url;
      };
      const fileset = {
        wasmLoaderPath: blobUrl(loaderBytes, 'text/javascript'),
        wasmBinaryPath: blobUrl(wasmBytes, 'application/wasm'),
      } as Fileset;
      return HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetBuffer: new Uint8Array(modelBytes), delegate: 'GPU' },
        runningMode: 'VIDEO',
        numHands: 1,
      });
    }

    const fileset = await FilesetResolver.forVisionTasks('mediapipe/wasm');
    return HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands: 1,
    });
  }

  async start(video: HTMLVideoElement): Promise<void> {
    if (this.status === 'starting' || this.status === 'running') return;
    this.status = 'starting';
    const epoch = ++this.epoch;
    const stale = () => epoch !== this.epoch;

    try {
      // macOS camera permission (no-op elsewhere / in plain browsers)
      const granted = (await window.nativeBridge?.requestCamera()) ?? true;
      if (stale()) return;
      if (!granted) {
        throw new HandTrackerError('no-permission');
      }

      const landmarker = await this.createLandmarker();
      if (stale()) {
        landmarker.close();
        return;
      }
      this.landmarker = landmarker;

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
        audio: false,
      });
      if (stale()) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      this.stream = stream;
      // Camera unplugged / revoked mid-session: surface an error instead of
      // droning the last tone forever (track 'ended' does not fire for our own stop())
      for (const track of stream.getTracks()) {
        track.onended = () => {
          if (this.status !== 'running' && this.status !== 'starting') return;
          this.stop();
          this.status = 'error';
          this.onError?.('camera-stopped');
        };
      }

      this.video = video;
      video.srcObject = stream;
      await video.play();
      if (stale()) return; // stop() already cleaned the assigned fields

      this.smoother.reset();
      this.pinch.reset();
      this.presence.reset();
      this.lastVideoTime = -1;
      this.lastPos = { x: 0.5, y: 0.5 };
      this.status = 'running';
      this.raf = requestAnimationFrame(this.loop);
    } catch (err) {
      if (stale()) return; // a newer start()/stop() owns the state now
      this.status = 'error';
      this.epoch++; // invalidate anything still in flight
      this.cleanup();
      console.error('Hand tracking failed to start', err);
      this.onError?.(classifyError(err));
      throw err;
    }
  }

  private loop = (): void => {
    if (this.status !== 'running' || !this.video || !this.landmarker) return;

    if (this.video.currentTime !== this.lastVideoTime && this.video.videoWidth > 0) {
      this.lastVideoTime = this.video.currentTime;
      let detected = false;
      // Dropout frames reuse the last known position — never jump to center
      let frame: HandFrame = {
        present: false,
        x: this.lastPos.x,
        y: this.lastPos.y,
        pinchStarted: false,
      };
      try {
        const result = this.landmarker.detectForVideo(this.video, performance.now());
        const landmarks = result.landmarks?.[0];
        if (landmarks && landmarks.length > LANDMARK.INDEX_TIP) {
          detected = true;
          const tip = landmarkToGrid(landmarks[LANDMARK.INDEX_TIP]);
          const smoothed = this.smoother.push(tip);
          this.lastPos = smoothed;
          const pinchStarted = this.pinch.update(
            landmarkToGrid(landmarks[LANDMARK.THUMB_TIP]),
            landmarkToGrid(landmarks[LANDMARK.INDEX_TIP]),
          );
          frame = { present: true, x: smoothed.x, y: smoothed.y, pinchStarted };
        }
      } catch (err) {
        console.warn('Hand detection frame failed', err);
      }
      const present = this.presence.update(detected);
      // Only restart smoothing once the hand is confirmed gone — a single
      // missed frame keeps the smoothing continuity
      if (!present) this.smoother.reset();
      this.onFrame?.({ ...frame, present });
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  stop(): void {
    this.epoch++; // cancel any in-flight start()
    this.status = 'idle';
    this.cleanup();
  }

  private cleanup(): void {
    cancelAnimationFrame(this.raf);
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.onended = null;
        track.stop();
      }
      this.stream = null;
    }
    if (this.video) {
      this.video.srcObject = null;
      this.video = null;
    }
    this.landmarker?.close();
    this.landmarker = null;
    for (const url of this.blobUrls) URL.revokeObjectURL(url);
    this.blobUrls = [];
    this.presence.reset();
    this.pinch.reset();
    this.smoother.reset();
  }
}
