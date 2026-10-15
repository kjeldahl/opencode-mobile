// Pure geometry for showing an image region inside a fixed box.
// Coordinates are image-space fractions (0..1), see media-url's crop fragment.

import type { Crop } from "./media-url.ts"

// Center-cover: for an image of `aspect` (w/h) in a box of `boxAspect`,
// the largest region that fills the box without distortion.
export function coverCrop(aspect: number, boxAspect: number): Crop {
  if (aspect >= boxAspect) {
    const w = boxAspect / aspect
    return { x: (1 - w) / 2, y: 0, w, h: 1 }
  }
  const h = aspect / boxAspect
  return { x: 0, y: (1 - h) / 2, w: 1, h }
}

// Grow/shrink the agent's region so it covers `boxAspect` exactly (centered),
// keeping it inside the image.
export function coverRegion(crop: Crop, aspect: number, boxAspect: number): Crop {
  const regionAspect = (crop.w / crop.h) * aspect
  if (regionAspect > boxAspect) {
    const w = (crop.h * boxAspect) / aspect
    if (w <= crop.w) return { x: crop.x + (crop.w - w) / 2, y: crop.y, w, h: crop.h }
  }
  const h = (crop.w * aspect) / boxAspect
  if (h <= crop.h) return { x: crop.x, y: crop.y + (crop.h - h) / 2, w: crop.w, h }
  const w = (crop.h * boxAspect) / aspect
  return { x: crop.x + (crop.w - w) / 2, y: crop.y, w, h: crop.h }
}

// Percentage offsets so a plain <Image> inside a clipped wrapper shows only
// `region`: the image box is scaled up by 1/w x 1/h and pushed back by x/w, y/h.
type Percent = `${number}%`

const pct = (v: number): Percent => `${v * 100}%` as Percent

export function regionStyle(crop: Crop): { left: Percent; top: Percent; width: Percent; height: Percent } {
  return {
    left: pct(-crop.x / crop.w),
    top: pct(-crop.y / crop.h),
    width: pct(1 / crop.w),
    height: pct(1 / crop.h),
  }
}
