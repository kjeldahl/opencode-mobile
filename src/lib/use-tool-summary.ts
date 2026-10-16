import { useEffect } from "react"
import { useSettings } from "../stores/settings"
import { useSummaries } from "../stores/summaries"
import { useModel } from "./local-llm"
import { wantsSummary } from "./summary-prompt"

// Tier 2 title for a tool card, or undefined while pending / disabled / failed.
export function useToolSummary(
  partId: string | undefined,
  tool: string | undefined,
  serverTitle: string | undefined,
  input: unknown,
  done: boolean,
): string | undefined {
  const enabled = useSettings((s) => s.aiSummaries)
  const always = useSettings((s) => s.aiSummariesAlways)
  const ready = useModel((s) => s.status === "ready")
  const wanted = enabled && wantsSummary({ tool, serverTitle, input, always })
  const summary = useSummaries((s) => (partId && wanted ? s.items[partId] : undefined))
  const request = useSummaries((s) => s.request)

  useEffect(() => {
    if (wanted && ready && done && partId && tool) request(partId, tool, input)
  }, [wanted, ready, done, partId, tool, input, request])

  return summary
}
