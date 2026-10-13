// Project helpers for the new-chat sheet (pure; see projects.test.ts).
import type { Project } from "./sdk"

// The project's directory. Undefined for the server's catch-all "global"
// project (worktree "/"), which is not a place to start a chat.
export function projectDir(project: Project | null | undefined): string | undefined {
  const dir = (project?.worktree || project?.path?.absolute)?.replace(/\/+$/, "")
  return dir || undefined
}

export function projectName(project: Project): string {
  const dir = projectDir(project)
  return project.name || dir?.split("/").filter(Boolean).pop() || project.id
}

// Without git the server tracks no changes (no Changes view, no counts).
export function tracksChanges(project: Project): boolean {
  return project.vcs === "git"
}

// Projects a new chat can start in: git repos first (most recently updated
// first), then the rest.
export function newChatProjects(projects: Project[]): Project[] {
  return projects
    .filter((project) => !!projectDir(project))
    .sort((a, b) => {
      const git = Number(tracksChanges(b)) - Number(tracksChanges(a))
      if (git !== 0) return git
      const time = (b.time?.updated ?? 0) - (a.time?.updated ?? 0)
      if (time !== 0) return time
      return projectName(a).localeCompare(projectName(b))
    })
}

// Plain "New chat": the connection's default directory, else the last project
// a chat was started in, else the server's own default (undefined).
export function newChatDir(connectionDir: string | undefined, recent: string[]): string | undefined {
  return connectionDir || recent[0] || undefined
}
