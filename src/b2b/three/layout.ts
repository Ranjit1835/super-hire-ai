// Shared geometry for the stage: the WebGL scene, the static fallback and the step labels all place blocks with
// these numbers, so a label always sits under its block whichever renderer is showing.
export const BLOCK_W = 1, BLOCK_H = 0.62, BLOCK_D = 0.62, GAP = 0.34;
/** Empty margin left and right of the row, and the frame height, in the same world units. */
export const PAD_X = 0.75, FRAME_H = 1.9; // PAD_X leaves room for the sway (±0.12 rad) and perspective at the ends

/** Width of the whole frame (row plus margins) for `count` blocks. */
export const frameWidth = (count: number) => count * BLOCK_W + Math.max(0, count - 1) * GAP + 2 * PAD_X;
/** Width / height of the frame. The stage box is sized to this so the camera fit and the labels agree. */
export const frameAspect = (count: number) => frameWidth(count) / FRAME_H;
/** Centre of block `i` as a fraction (0..1) of the frame width. */
export const blockCentre = (i: number, count: number) => (PAD_X + i * (BLOCK_W + GAP) + BLOCK_W / 2) / frameWidth(count);
/** Block width and pitch as fractions of the frame width. */
export const blockFraction = (count: number) => BLOCK_W / frameWidth(count);
export const pitchFraction = (count: number) => (BLOCK_W + GAP) / frameWidth(count);
