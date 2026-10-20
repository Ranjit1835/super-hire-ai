// Snapshots (no continuous video): grab one frame from the screen or webcam stream, compress it (WebP/JPEG ~70%),
// and upload it in the background with retry. Uploads never block the test; when the queue is full the oldest
// periodic snapshot is dropped first.

export type SnapKind = "screen" | "camera";
export type SnapType = "image/jpeg" | "image/webp";

export const SNAPSHOT_QUALITY = 0.7;
export const MAX_WIDTH: Record<SnapKind, number> = { screen: 1280, camera: 480 };

/** A hidden <video> playing `stream` (needed to grab frames). */
export function videoFor(stream: MediaStream): HTMLVideoElement {
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  v.autoplay = true;
  v.srcObject = stream;
  void v.play?.()?.catch?.(() => undefined);
  return v;
}

export async function captureFrame(video: HTMLVideoElement | null, kind: SnapKind, canvas = document.createElement("canvas")): Promise<{ blob: Blob; type: SnapType } | null> {
  if (!video || !video.videoWidth || !video.videoHeight) return null;
  const scale = Math.min(1, MAX_WIDTH[kind] / video.videoWidth);
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/webp", SNAPSHOT_QUALITY));
  if (blob && blob.type === "image/webp") return { blob, type: "image/webp" };
  const jpeg = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", SNAPSHOT_QUALITY));
  return jpeg ? { blob: jpeg, type: "image/jpeg" } : null;
}

export interface UploadJob { path: string; token: string; blob: Blob; type: SnapType; periodic: boolean }

/** Sequential background uploader with retry/backoff. */
export class SnapshotUploader {
  private jobs: UploadJob[] = [];
  private running = false;
  private stopped = false;

  constructor(
    private readonly upload: (job: UploadJob) => Promise<void>,
    private readonly opts: { maxQueued?: number; attempts?: number; backoffMs?: number } = {},
  ) {}

  get queued() { return this.jobs.length; }

  enqueue(job: UploadJob) {
    if (this.stopped) return;
    this.jobs.push(job);
    const max = this.opts.maxQueued ?? 6;
    while (this.jobs.length > max) {
      const i = this.jobs.findIndex((j) => j.periodic);
      this.jobs.splice(i >= 0 ? i : 0, 1);
    }
    void this.run();
  }

  stop() { this.stopped = true; }

  private async run() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.jobs.length && !this.stopped) {
        const job = this.jobs.shift()!;
        const attempts = this.opts.attempts ?? 3;
        for (let a = 0; a < attempts; a++) {
          try { await this.upload(job); break; } catch {
            if (a < attempts - 1) await new Promise((r) => setTimeout(r, (this.opts.backoffMs ?? 2000) * 2 ** a));
          }
        }
      }
    } finally {
      this.running = false;
    }
  }
}
