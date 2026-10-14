// Thoughts that fit on one line render inline; longer ones collapse behind
// a header showing their first line, so the topic is visible without opening.
// Expanded, the header shows the whole first line and the body the rest.
const SHORT = 80

const clean = (line: string) =>
  line
    .replace(/^#+\s*/, "")
    .replace(/\*\*|__/g, "")
    .trim()

export function reasoningView(text: string) {
  const lines = text.trim().split("\n")
  const short = lines.length === 1 && lines[0].length <= SHORT
  return { short, title: clean(lines[0]), body: lines.slice(1).join("\n").trim() }
}
