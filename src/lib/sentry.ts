// Local-only crash logging. This fork sends no telemetry: the upstream Sentry
// wrapper is replaced by these no-op-or-log helpers so call sites stay the same.
// Uncaught errors still land in the in-memory log buffer, and therefore in any
// diagnostic report the user chooses to share.

import { log } from "./logbuffer"
import type { DiagnosticReport } from "./diagnostics"

export type Breadcrumb = {
  category: string
  message: string
  level?: "debug" | "info" | "warning" | "error"
  data?: Record<string, unknown>
}

export function addBreadcrumb(_crumb: Breadcrumb) {}

export function captureException(
  err: unknown,
  _context?: { tags?: Record<string, string>; extra?: Record<string, unknown>; level?: string },
) {
  log.error("crash", "captureException", toError(err).message)
}

export function captureDiagnostic(report: DiagnosticReport) {
  log.info("diag", "connect failed", report.classification)
}

function toError(value: unknown): Error {
  if (value instanceof Error) return value
  if (typeof value === "string") return new Error(value)
  try {
    return new Error(JSON.stringify(value))
  } catch {
    return new Error(String(value))
  }
}

let installed = false

export function installCrashLogging() {
  if (installed) return
  installed = true

  type GlobalErrorUtils = {
    getGlobalHandler?: () => (err: unknown, isFatal?: boolean) => void
    setGlobalHandler?: (handler: (err: unknown, isFatal?: boolean) => void) => void
  }
  const errorUtils = (globalThis as unknown as { ErrorUtils?: GlobalErrorUtils }).ErrorUtils
  if (errorUtils?.setGlobalHandler && errorUtils?.getGlobalHandler) {
    const previous = errorUtils.getGlobalHandler()
    errorUtils.setGlobalHandler((err: unknown, isFatal?: boolean) => {
      const error = toError(err)
      log.error("crash", isFatal ? "FATAL" : "non-fatal", error.message, error.stack ?? "")
      previous?.(err, isFatal)
    })
  }

  type GlobalRejection = {
    onunhandledrejection?: (event: { reason?: unknown; promise?: unknown }) => void
  }
  const g = globalThis as unknown as GlobalRejection
  const prev = g.onunhandledrejection
  g.onunhandledrejection = (event) => {
    const error = toError(event?.reason)
    log.error("crash", "unhandled-rejection", error.message, error.stack ?? "")
    prev?.(event)
  }
}
