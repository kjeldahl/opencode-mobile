// GitHub issue #38: the subagent ("task" tool) card never showed the
// subagent's response. opencode wraps it in its own bookkeeping, either
//   task_id: ses_… (for resuming…)\n\n<task_result>\n…\n</task_result>
// or (older servers) the plain text followed by a <task_metadata> block.
// Pull out just the response text for display.
export function taskResult(output: unknown): string | undefined {
  if (typeof output !== "string") return undefined
  const wrapped = output.match(/<task_result>\n?([\s\S]*?)\n?<\/task_result>/)
  const text = wrapped
    ? wrapped[1]
    : output.replace(/<task_metadata>[\s\S]*?<\/task_metadata>/g, "").replace(/^task_id:.*$/m, "")
  const trimmed = text.trim()
  return trimmed.length > 0 ? trimmed : undefined
}
