import { test } from "node:test"
import assert from "node:assert/strict"
import { createElement } from "react"
import { collectImages, isWhitespaceNode } from "./markdown-gallery.ts"

// Stand-ins for the two component identities collectImages dispatches on.
const IMAGE = "Image"
const STRIP = "Strip"

const image = (uri: string, alt?: string) => createElement(IMAGE, { uri, alt })
const strip = (...uris: string[]) => createElement(STRIP, { images: uris.map((uri) => ({ uri })) })
const row = (...children: unknown[]) => createElement("row", null, ...children)

test("collectImages walks nested blocks in document order", () => {
  const tree = [
    createElement("p", null, "text"),
    row(image("a.png"), image("b.png")),
    strip("c.png", "d.png"),
    image("e.png"),
  ]
  assert.deepEqual(collectImages(tree, IMAGE, STRIP), [
    { raw: "a.png", alt: undefined },
    { raw: "b.png", alt: undefined },
    { raw: "c.png", alt: undefined },
    { raw: "d.png", alt: undefined },
    { raw: "e.png", alt: undefined },
  ])
})

test("collectImages keeps alt text and survives missing/falsy nodes", () => {
  assert.deepEqual(collectImages(image("x.png", "caption"), IMAGE, STRIP), [{ raw: "x.png", alt: "caption" }])
  assert.deepEqual(collectImages(null, IMAGE, STRIP), [])
  assert.deepEqual(collectImages([null, undefined, "text"], IMAGE, STRIP), [])
})

test("collectImages descends through wrappers that hold children", () => {
  const nested = row(row(image("deep.png")))
  assert.deepEqual(collectImages(nested, IMAGE, STRIP), [{ raw: "deep.png", alt: undefined }])
})

test("whitespace nodes between image lines are recognized as whitespace", () => {
  assert.equal(isWhitespaceNode("\n"), true)
  assert.equal(isWhitespaceNode("  "), true)
  assert.equal(isWhitespaceNode("x"), false)
  assert.equal(isWhitespaceNode(row("x")), false)
  assert.equal(isWhitespaceNode(row("\n", " ")), true)
})
