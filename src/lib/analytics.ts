// Analytics stub. This fork sends no telemetry: upstream's PostHog wrapper is
// replaced by a no-op `track` so call sites stay unchanged.

export { classifyConnectionError, type ConnectionErrorClass } from "./analytics-classify"

/** Activation-funnel events. Keep this list in 1:1 sync with the funnel steps
 *  tracked in the product analytics dashboard. */
export enum AnalyticsEvent {
  /** Fired once per app session, as soon as analytics is enabled (either at
   *  cold start with prior consent, or right after consent is granted). */
  AppOpened = "app_opened",
  /** User tapped Connect/Save with a non-empty server URL (quick or advanced mode). */
  ConnectionFormSubmitted = "connection_form_submitted",
  /** A real network call to test/establish the connection started. */
  ConnectionAttempted = "connection_attempted",
  /** The connection attempt succeeded (health check / project fetch responded). */
  ConnectionSucceeded = "connection_succeeded",
  /** The connection attempt failed. Always paired with `error_class`. */
  ConnectionFailed = "connection_failed",
  /** User sent a prompt/message to an agent session (excludes slash commands). */
  MessageSent = "message_sent",
  /** An agent response finished streaming (session transitioned busy -> idle),
   *  excluding user-aborted runs. */
  ResponseReceived = "response_received",
  /** Fired once when the offline `/demo` screen mounts. */
  DemoStarted = "demo_started",
  /** User advanced a step in the scripted demo (currently: replied to the
   *  demo's permission prompt). Always paired with `step_index`/`step_name`. */
  DemoStepAdvanced = "demo_step_advanced",
  /** The scripted demo reached its end (completion or denial message shown
   *  after the permission reply). The key activation metric for the demo —
   *  see distribution/retention-analysis.md. Always paired with `outcome`. */
  DemoCompleted = "demo_completed",
  /** User tapped "Connect your own server" on the demo's CTA card. */
  DemoExitedToConnect = "demo_exited_to_connect",
}

/** Where a connection test/failure was initiated from. The activation funnel
 *  filters to source=onboarding only; edit_test (Test button on the
 *  existing-connection edit screen) and sse (background reconnect loop,
 *  see events.ts) would otherwise pollute the funnel with repeat-tester and
 *  post-activation noise. */
export type ConnectionTestSource = "onboarding" | "edit_test" | "sse"

export type AnalyticsProps = Record<string, string | number | boolean | null>

export function track(_event: AnalyticsEvent, _props?: AnalyticsProps) {}
