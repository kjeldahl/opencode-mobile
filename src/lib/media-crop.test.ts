import { test } from "node:test"
import assert from "node:assert/strict"
import { coverCrop, coverRegion, regionStyle } from "./media-crop.ts"

test("coverCrop of a tall screenshot center-crops vertically", () => {
  const crop = coverCrop(0.25, 16 / 11) // 200x800 image, wide box
  assert.equal(crop.x, 0)
  assert.equal(crop.w, 1)
  assert.ok(crop.h < 1)
  assert.ok(crop.y > 0 && crop.y * 2 + crop.h === 1)
  assert.ok(Math.abs((crop.w / crop.h) * 0.25 - 16 / 11) < 1e-9)
})

test("coverCrop of a wide image keeps the full height and trims the sides", () => {
  const crop = coverCrop(2, 4 / 3) // 2000x1000
  assert.equal(crop.y, 0)
  assert.equal(crop.h, 1)
  assert.ok(crop.w < 1)
  assert.ok(Math.abs((crop.w / crop.h) * 2 - 4 / 3) < 1e-9)
})

test("coverCrop is the full image when aspects already match", () => {
  const crop = coverCrop(1.5, 1.5)
  assert.deepEqual(crop, { x: 0, y: 0, w: 1, h: 1 })
})

test("coverRegion keeps the agent's region but grows it to fill the box", () => {
  // Agent marks the top fifth of a tall screenshot; region must still fill a 4:3 box.
  const region = coverRegion({ x: 0, y: 0, w: 1, h: 0.2 }, 0.25, 4 / 3)
  assert.equal(region.x, 0)
  assert.equal(region.w, 1)
  assert.ok(region.h <= 0.2 && region.h > 0)
  assert.ok(Math.abs((region.w / region.h) * 0.25 - 4 / 3) < 1e-9)
})

test("coverRegion trims a wide region down to the box", () => {
  const region = coverRegion({ x: 0, y: 0, w: 1, h: 1 }, 2, 1)
  assert.equal(region.y, 0)
  assert.equal(region.h, 1)
  assert.ok(region.w < 1 && region.w > 0)
  assert.ok(Math.abs((region.w / region.h) * 2 - 1) < 1e-9)
})

test("regionStyle offsets and sizes by region fractions", () => {
  const style = regionStyle({ x: 0.25, y: 0, w: 0.5, h: 1 })
  assert.equal(style.left, "-50%")
  assert.equal(style.top, "0%")
  assert.equal(style.width, "200%")
  assert.equal(style.height, "100%")
})
