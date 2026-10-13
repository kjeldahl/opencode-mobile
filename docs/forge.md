# OpenCode forge (fork notes)

App ID `it.kjeldahl.opencode`, name "OpenCode forge"; installs next to the store app.
No telemetry: Sentry, PostHog, Chatwoot and the waitlist are removed. The update
banner checks `kjeldahl/opencode-mobile` releases, so tag `vX.Y.Z` = `app.json` version.

## Workspace links (hub "Open in app")

```
opencode://connect?url=<base url>&name=<ws>&user=opencode&dir=<repo dir>[&session=<id>]
intent://connect?url=...&name=...&user=...&dir=...#Intent;scheme=opencode;package=it.kjeldahl.opencode;end
```

- URL-encode every value. Never put the password in the link.
- Use the `intent://` form in web pages: Chrome opens it reliably and it targets this
  app even when the store app (same `opencode` scheme) is installed.
- Known `url`: the app activates that connection, makes `dir` its default directory,
  opens Sessions (or the chat when `session` is given).
- New `url`: the app asks for the password once (stored in SecureStore), tests, saves.

## Changes view

Per chat: Branch (`/vcs/diff?mode=branch`), Uncommitted (`/vcs/diff?mode=git`),
This turn (`/session/<id>/diff?messageID=<last user msg>`). Session list and chat
header counts come from the branch diff (uncommitted on the default branch), not
from `session.summary`.
