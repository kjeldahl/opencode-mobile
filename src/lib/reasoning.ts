// Thoughts that fit on one line render inline; longer ones collapse behind
// a header showing their first line, so the topic is visible without opening.
const SHORT = 80

const clean = (line: string) =>
  line
    .replace(/^#+\s*/, "")
    .replace(/\*\*|__/g, "")
    .trim()

export function reasoningView(text: string) {
  const body = text.trim()
  const first = clean(body.split("\n").find((line) => line.trim().length > 0) ?? "")
  const short = !body.includes("\n") && body.length <= SHORT
  return { short, title: first }
}
