# Port the app to the opencode 2 server API — brief (2026-11-11)

Written from the DGX side (forge). Forge workspaces now run either opencode **1.18.32** (default) or **2.x**
(trial: `forge opencode <ws> 2`; the trial workspace `oc2-trial` runs **2.0.29**, the version sbx 0.51's opencode
kit ships). The app talks only the v1 API, so it cannot use a v2 workspace. Goal: the app works against both, so
the workspaces can move to v2 one at a time.

Files next to this brief, all captured from a real 2.0.29 server:
- `openapi-2.0.29.json` — the server's own `/openapi.json` (the source of truth for routes and schemas)
- `sample-messages.json` — `GET /api/session/{id}/message` for a chat with reasoning, a shell tool call and text
- `sample-session.json` — `GET /api/session/{id}`
- `sample-events.sse` — the `/api/event` stream for that whole chat (session created → tool call → idle)

## Recommended shape

- **Keep the screens and stores' internal types.** Add a v2 adapter in the client layer (`src/lib/sdk.ts` or a
  sibling) that maps v2 responses and events into the shapes the stores already use (Session, Message, Part,
  the `message.updated` / `message.part.updated` updates the event store consumes).
- **Detect per connection:** `GET /api/info` (with auth) → `application/json` `{"version":"2.x",…}` = v2. A 1.x
  server answers the same request with **200 and its web app's HTML** (checked on 1.18.32), so test the content
  type / parse result, not the status. Anything that isn't v2 JSON = v1. Cache per server; re-detect on reconnect.
- Both majors must keep working; existing 1.x workspaces are the default for a while.
- Extend `tests/fixtures/mock-opencode-server.ts` with a v2 mode built from the samples, and cover the adapter
  with tests (message mapping, event mapping incl. streaming deltas, permission/question round trip).

## What is the same

- Basic auth, user `opencode`, same password; 401 carries `WWW-Authenticate: Basic realm="Secure Area"`.
- Same forge URLs/ports; forge's own routes are unchanged: `/__forge/pr`, `/__forge/file`, `/__forge/apk`.
- The workspace "waking" behaviour of forge's front is unchanged (503 + Retry-After while it starts).

## What changed

- Everything is under **`/api/*`**. Unknown non-API paths return the v2 web app's HTML with **200** — check the
  content type; never treat a 200 as JSON blindly.
- Folder selection: **`?location[directory]=<abs path>`** (deepObject; URL-encode the brackets), not
  `?directory=`. Request bodies use `"location": {"directory": "…"}`. Responses are wrapped:
  `{"data": …}`, often with `"location"` and list `"cursor": {"previous","next"}` (paginated).
- Projects: `GET /api/location?location[directory]=…` resolves (and creates) the project for a folder;
  `GET /api/project` lists them (`canonical` = folder). Forge registers every repo this way.

### Route map (v1 call the app makes today → v2)

| App use (from forge access logs) | v1 | v2 (check `openapi-2.0.29.json`) |
|---|---|---|
| health | `/global/health` | `/api/info` |
| change detection | `/vcs`, `/vcs/diff` | `/api/vcs`, `/api/vcs/status`, `/api/vcs/diff`, `/api/vcs/branch` |
| chat list | `/experimental/session`, `/session` | `GET /api/session` (paginated) , `GET /api/session/active` (running ones, server-wide) |
| chat | `GET/PATCH/DELETE /session/{id}` | `/api/session/{id}` |
| new chat | `POST /session` | `POST /api/session` `{location:{directory}, title?, agent?, model?}` |
| messages | `/session/{id}/message` | `/api/session/{id}/message` — **newest first**, cursor-paginated; `/message/{messageID}` for one |
| send | `POST /session/{id}/prompt_async` | `POST /api/session/{id}/prompt` `{text, files?, agents?, skills?}` (returns the admitted user message; work continues async) |
| stop | `POST /session/{id}/abort` | `POST /api/session/{id}/interrupt` |
| revert / unrevert | `/session/{id}/revert`, `/unrevert` | `/api/session/{id}/revert/stage` + `/revert/commit`, `DELETE /api/session/{id}/revert` |
| chat diff | `/session/{id}/diff` | `/api/session/{id}/diff` |
| events | `/global/event` | `GET /api/event` (SSE, all folders) |
| permissions | `GET /permission`, `POST /permission/{id}/reply` | `GET /api/permission/request?location[directory]=`, `POST /api/session/{sessionID}/permission/{requestID}/reply` |
| questions | `GET /question`, `POST /question/{id}/reply` | "forms": `GET /api/form?location[directory]=`, `POST /api/session/{sessionID}/form/{formID}/reply` |
| models | `/provider` | `/api/provider`, `/api/model`, `/api/model/default` |
| commands / agents | `/command`, `/agent` | `/api/command`, `/api/agent` |
| paths | `/path`, `/project/current` | `/api/location` |
| files | `/file`, `/file/roots` | `/api/fs/list`, `/api/fs/read/*`, `/api/fs/find` |
| terminal | `/api/pty…` | same family under `/api/pty` (already used) |

### Messages (see `sample-messages.json`)

- One list of entries with `type`: `user` (`text`, files), `assistant` (`agent`, `model{id,providerID}`,
  `content[]`, `finish`, `tokens`, `cost`, `snapshot{start,end,files}`), and markers such as `idle`
  (`outcome`). Assistant `content[]` items: `reasoning` (`text`, `time`), `text` (`text`), `tool` (`id`, `name`,
  `state{status,input,content[],metadata}`, `time{created,ran,completed}`). Tool names changed too
  (`bash`→`shell`, `task`→`subagent`, `write`/`patch`→`edit`).
- v1 had separate message + parts; map `content[i]` to parts (stable part id = message id + index or the tool `id`).

### Events (see `sample-events.sse`)

- `data: {"id","created","type","location":{"directory"},"data":{…},"durable":{…}}` plus `: heartbeat` lines.
- Granular instead of whole parts: `session.created`, `session.execution.started|succeeded`,
  `session.step.started|ended`, `session.reasoning.started|delta|ended`, `session.text.started|delta|ended`,
  `session.tool.input.started|ended`, `session.tool.called|progress|success`, `session.usage.updated`,
  `session.inbox.enqueued|delivered`, `shell.created|exited`, and permission/form events (not yet captured —
  trigger one against a v2 server and record it). The adapter has to accumulate deltas into the current part and
  emit the app's existing update shape; on reconnect, refetch the open chat (the stream is volatile: missed events
  are gone).

## How to test against a real v2 server

- This sandbox predates sbx 0.51 and has no v2 binary. Install one into its own prefix and run it on a spare port:
  `npm i --prefix ~/oc2 @opencode/cli@2.0.29` → `~/oc2/node_modules/.bin/opencode serve --hostname 127.0.0.1 --port 4196`
  with `OPENCODE_SERVER_PASSWORD` set and `OPENCODE_CONFIG=/home/agent/.forge/opencode.json` (the dgx model config;
  v2 accepts the v1 keys). Use **2.0.29** (what the workspaces run); npm's latest is newer (2.2.x at the time of
  writing) and the API may have moved — check `/openapi.json` of whatever you run.
- On the phone: the trial workspace `oc2-trial` (port 4305) runs v2; build a dev APK (`/__forge/apk`) and point
  it there.
- Watch the app's network calls against both majors; the 1.x path must not regress.

Not in scope: changing forge itself (front/forge already handle both majors), migrating old 1.x chats.
