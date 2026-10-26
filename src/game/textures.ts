import * as THREE from "three";

export interface GameFonts {
  /** Impact-style display face for numerals (CSS font-family string). */
  display: string;
  /** Japanese brush/gothic face for the banner and SFX. */
  jp: string;
}

const redrawers = new Set<() => void>();

/**
 * Canvas texture whose drawing is replayed once web fonts finish loading, so
 * text drawn before the fonts arrive does not stay in a fallback face.
 */
export function drawnTexture(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const redraw = () => {
    ctx.clearRect(0, 0, width, height);
    draw(ctx, width, height);
    texture.needsUpdate = true;
  };
  redraw();
  redrawers.add(redraw);
  return texture;
}

export async function redrawWhenFontsLoad(fonts: GameFonts) {
  try {
    await Promise.all([
      document.fonts.load(`100px ${fonts.display}`),
      document.fonts.load(`100px ${fonts.jp}`, "全国制覇ドリブル"),
    ]);
  } catch {
    // Fallback faces are fine; nothing to redraw.
    return;
  }
  redrawers.forEach((r) => r());
}

export function clearDrawnTextures() {
  redrawers.clear();
}
