// GitHub issue #30: tool cards showed just "bash" when the server gave no
// title. Tier 1 = static heuristics (no model call). Returns undefined when
// nothing better than the server title / tool name can be said.
type Input = Record<string, unknown> | undefined

const MAX = 60

function clip(text: string): string {
  const one = text.replace(/\s+/g, " ").trim()
  return one.length > MAX ? `${one.slice(0, MAX - 1)}…` : one
}

function str(input: Input, key: string): string | undefined {
  const v = input?.[key]
  return typeof v === "string" && v.trim() ? v : undefined
}

// Title is "generic" when absent or just the tool name.
export function isGeneric(title: string | undefined, tool: string | undefined): boolean {
  const t = title?.trim()
  if (!t) return true
  return t.toLowerCase() === tool?.toLowerCase()
}

const SCRIPT = /^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?([\w:.-]+)/

const SCRIPTS: Record<string, string> = {
  test: "Runs tests",
  lint: "Runs linter",
  build: "Builds project",
  typecheck: "Type-checks project",
  tsc: "Type-checks project",
  format: "Formats code",
  dev: "Starts dev server",
  start: "Starts app",
}

function git(rest: string): string | undefined {
  const sub = rest.split(/\s+/)[0]
  if (sub === "commit") {
    const msg = rest.match(/-m\s+(?:"([^"]*)"|'([^']*)')/)
    const text = msg?.[1] ?? msg?.[2]
    return text ? `Commits: ${clip(text.split("\n")[0])}` : "Commits changes"
  }
  const map: Record<string, string> = {
    status: "Checks git status",
    diff: "Shows git diff",
    log: "Shows git log",
    push: "Pushes commits",
    pull: "Pulls changes",
    fetch: "Fetches remote",
    add: "Stages changes",
    checkout: "Switches branch",
    switch: "Switches branch",
    branch: "Lists branches",
    merge: "Merges branch",
    rebase: "Rebases branch",
    stash: "Stashes changes",
    clone: "Clones repository",
  }
  return map[sub]
}

export function bashTitle(command: string): string | undefined {
  // First command of a chain: `cd x && npm test` -> npm test
  const parts = command.split(/\s*(?:&&|;|\|\|)\s*/).filter((p) => !/^cd\s/.test(p))
  const cmd = (parts[0] ?? command).trim()
  if (!cmd) return undefined
  const [bin, ...args] = cmd.split(/\s+/)
  const rest = args.join(" ")
  if (bin === "git") return git(rest)
  const script = cmd.match(SCRIPT)
  if (script) {
    const mapped = SCRIPTS[script[1].split(":")[0]]
    if (mapped) return mapped
    if (/^(npm|pnpm|yarn|bun)\s+(i|install|add)\b/.test(cmd)) return "Installs dependencies"
    return `Runs ${script[1]} script`
  }
  if (/^(npm|pnpm|yarn|bun)\s+(i|install|add)\b/.test(cmd)) return "Installs dependencies"
  if (/^(npx\s+)?(tsc)\b/.test(cmd)) return "Type-checks project"
  if (/^(npx\s+)?eslint\b/.test(cmd)) return /--fix/.test(cmd) ? "Runs ESLint with auto-fix" : "Runs ESLint"
  if (/^(npx\s+)?(jest|vitest|pytest)\b/.test(cmd) || /^node\s+--test\b/.test(cmd)) return "Runs tests"
  const find = (word: string) => args.find((a) => !a.startsWith("-") && a !== word)
  switch (bin) {
    case "grep":
    case "rg": {
      const pattern = args.filter((a) => !a.startsWith("-"))
      return pattern[0] ? `Searches for ${clip(pattern[0].replace(/^["']|["']$/g, ""))}` : undefined
    }
    case "ls":
      return `Lists ${find("ls") ?? "directory"}`
    case "cat":
      return find("cat") ? `Reads ${clip(find("cat")!)}` : undefined
    case "mkdir":
      return find("mkdir") ? `Creates ${clip(find("mkdir")!)}` : undefined
    case "rm":
      return find("rm") ? `Deletes ${clip(find("rm")!)}` : undefined
    case "curl":
      return find("curl") ? `Fetches ${clip(find("curl")!)}` : undefined
    case "pwd":
      return "Prints working directory"
    default:
      return undefined
  }
}

export function toolTitle(tool: string | undefined, input: Input): string | undefined {
  if (!tool) return undefined
  if (tool === "bash") {
    const desc = str(input, "description")
    if (desc) return clip(desc)
    const command = str(input, "command")
    return command ? (bashTitle(command) ?? clip(command)) : undefined
  }
  if (tool === "grep") {
    const pattern = str(input, "pattern")
    return pattern ? `Searches for ${clip(pattern)}` : undefined
  }
  if (tool === "glob") {
    const pattern = str(input, "pattern")
    return pattern ? `Finds ${clip(pattern)}` : undefined
  }
  if (tool === "webfetch") {
    const url = str(input, "url")
    return url ? `Fetches ${clip(url)}` : undefined
  }
  return undefined
}

// Card header title: server title unless generic, then heuristic, then tool name.
export function cardTitle(tool: string | undefined, serverTitle: string | undefined, input: Input): string | undefined {
  if (!isGeneric(serverTitle, tool)) return serverTitle
  return toolTitle(tool, input) ?? serverTitle ?? tool
}
