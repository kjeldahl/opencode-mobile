import { test } from "node:test"
import assert from "node:assert/strict"
import { taskResult } from "./task-output.ts"

test("extracts the response from <task_result>", () => {
  const out = "task_id: ses_abc (for resuming to continue this task if needed)\n\n<task_result>\n## Done\n\nFound 3 files.\n</task_result>"
  assert.equal(taskResult(out), "## Done\n\nFound 3 files.")
})

test("strips the legacy <task_metadata> trailer", () => {
  const out = "Found 3 files.\n\n<task_metadata>\nsession_id: ses_abc\n</task_metadata>"
  assert.equal(taskResult(out), "Found 3 files.")
})

test("passes plain output through", () => {
  assert.equal(taskResult("  just text \n"), "just text")
})

test("returns undefined for missing or empty output", () => {
  assert.equal(taskResult(undefined), undefined)
  assert.equal(taskResult({ x: 1 }), undefined)
  assert.equal(taskResult("task_id: ses_abc\n\n<task_result>\n\n</task_result>"), undefined)
})
