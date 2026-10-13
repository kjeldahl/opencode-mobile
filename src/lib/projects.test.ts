import { test } from "node:test"
import assert from "node:assert/strict"
import { newChatDir, newChatProjects, projectDir, projectName, tracksChanges } from "./projects.ts"

const project = (id: string, worktree: string, extra: Record<string, unknown> = {}) => ({ id, worktree, ...extra })

test("projectDir reads worktree, falls back to the legacy path shape", () => {
  assert.equal(projectDir(project("a", "/home/u/repo/")), "/home/u/repo")
  assert.equal(projectDir({ id: "b", path: { cwd: "", root: "", absolute: "/old" } }), "/old")
  assert.equal(projectDir(project("g", "/")), undefined)
  assert.equal(projectDir(null), undefined)
})

test("projectName prefers the name, then the last path segment", () => {
  assert.equal(projectName(project("a", "/home/u/repo", { name: "Repo" })), "Repo")
  assert.equal(projectName(project("a", "/home/u/repo")), "repo")
  assert.equal(projectName({ id: "x" }), "x")
})

test("newChatProjects drops the global project and lists git repos first", () => {
  const list = [
    project("global", "/"),
    project("work", "/home/u/work", { time: { created: 0, updated: 9 } }),
    project("old", "/home/u/old", { vcs: "git", time: { created: 0, updated: 1 } }),
    project("new", "/home/u/new", { vcs: "git", time: { created: 0, updated: 5 } }),
  ]
  assert.deepEqual(newChatProjects(list).map((p) => p.id), ["new", "old", "work"])
  assert.equal(tracksChanges(list[1]), false)
})

test("newChatDir: connection default, then last used, then server default", () => {
  assert.equal(newChatDir("/repo", ["/recent"]), "/repo")
  assert.equal(newChatDir(undefined, ["/recent", "/older"]), "/recent")
  assert.equal(newChatDir(undefined, []), undefined)
})
