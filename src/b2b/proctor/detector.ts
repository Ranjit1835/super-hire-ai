// Camera checks with MediaPipe FaceLandmarker, in the browser. Nothing leaves the device: each frame is reduced to
// "how many faces" and a head pose, then discarded. Runs throttled on the main thread at ≤ 5 fps (tier-dependent),
// using the CPU delegate on low tiers. (A Web Worker with OffscreenCanvas is a fast-follow; the throttled loop
// measured fine for 2 fps on a dual-core laptop in the pilot.) Adapted from the pilot's detector.ts.
import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import { anglesFromLandmarks, headAngles } from "./headPose";

// Pinned to the installed package version so the WASM matches the JS.
const MEDIAPIPE_VERSION = "1.1.1";
const WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

export interface FaceFrame {
  t: number;
  faces: number;
  /** [yaw, pitch] in radians when exactly one face is visible. */
  pose: [number, number] | null;
}

export interface FaceDetectorLike {
  detectForVideo: FaceLandmarker["detectForVideo"];
}

let landmarkerPromise: Promise<FaceLandmarker> | null = null;

/** Load (once) the face landmarker. GPU first on capable machines, CPU otherwise / as fallback. */
export function loadLandmarker(preferGpu = true): Promise<FaceLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
      const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
      const make = (delegate: "GPU" | "CPU") => FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: "VIDEO",
        numFaces: 2,                         // enough to tell "someone else is here"
        outputFacialTransformationMatrixes: true,
        outputFaceBlendshapes: false,
      });
      if (!preferGpu) return make("CPU");
      try { return await make("GPU"); } catch { return make("CPU"); }
    })();
    landmarkerPromise.catch(() => { landmarkerPromise = null; }); // allow a retry
  }
  return landmarkerPromise;
}

/** Run detection on `video` at `fps` (capped at 5) until the returned stop function is called. */
export function startFaceLoop(det: FaceDetectorLike, video: HTMLVideoElement, fps: number, onFrame: (f: FaceFrame) => void): () => void {
  const interval = 1000 / Math.max(0.5, Math.min(5, fps));
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastTs = -1;
  const step = () => {
    if (stopped) return;
    const started = performance.now();
    if (video.readyState >= 2 && video.videoWidth) {
      const ts = Math.max(lastTs + 1, Math.round(started)); // strictly increasing timestamps
      lastTs = ts;
      try {
        const r = det.detectForVideo(video, ts);
        const faces = r.faceLandmarks.length;
        let pose: [number, number] | null = null;
        if (faces === 1) {
          const m = r.facialTransformationMatrixes?.[0]?.data;
          pose = m && m.length >= 16 ? headAngles(m) : anglesFromLandmarks(r.faceLandmarks[0]);
        }
        onFrame({ t: Date.now(), faces, pose });
      } catch { /* a dropped frame is fine */ }
    }
    // Never queue frames behind a slow detection.
    timer = setTimeout(step, Math.max(50, interval - (performance.now() - started)));
  };
  timer = setTimeout(step, interval);
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}

/** 16×12 grayscale thumbnail of the current frame (frozen-camera check). */
export function tinyFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement): Uint8ClampedArray | null {
  if (!video.videoWidth) return null;
  canvas.width = 16; canvas.height = 12;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, 16, 12);
  const d = ctx.getImageData(0, 0, 16, 12).data;
  const g = new Uint8ClampedArray(16 * 12);
  for (let i = 0; i < g.length; i++) g[i] = (d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 3;
  return g;
}

/** Real webcams always have sensor noise; two bit-identical thumbnails seconds apart mean a frozen feed. */
export function framesIdentical(a: Uint8ClampedArray | null, b: Uint8ClampedArray | null): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i]);
  return diff / a.length < 0.25;
}

/** Device-label heuristic for virtual cameras (OBS, ManyCam, …). A hint for the reviewer, nothing more. */
export function looksVirtual(label: string): boolean {
  return /virtual|obs|manycam|snap camera|xsplit|droidcam|epoccam|camtwist|iriun|mmhmm/i.test(label);
}
