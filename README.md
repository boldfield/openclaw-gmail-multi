# openclaw-gmail-multi

Multi-account Gmail integration plugin for [OpenClaw](https://github.com/boldfield/openclaw). Replaces the built-in `hooks.gmail` with a flexible, prompt-driven pipeline that supports multiple Gmail accounts. Delegates to [`gog`](https://github.com/boldfield/gog) CLI for OAuth, Gmail Watch API, and Pub/Sub handling.

Each configured account gets its own `gog gmail watch serve` child process. Incoming emails are routed to agent sessions via openclaw's built-in `hooks.mappings` configuration — enabling multi-stage LLM pipelines (e.g., Haiku classifies, Sonnet handles).

## Installation

### Via PVC sync (nightshift)

Add the repo to your nightshift `repos.yaml`:

```yaml
- url: https://github.com/boldfield/openclaw-gmail-multi
  name: openclaw-gmail-multi
  account: personal
```

Add to nightshift `config.yaml` projects:

```yaml
- path: /repos/openclaw-gmail-multi
```

### Via init container

Add a `sync-plugins` init container to your openclaw deployment:

```yaml
- name: sync-plugins
  image: node:22-alpine
  command: ["sh", "-c"]
  args:
    - |
      apk add --no-cache git
      PLUGIN_DIR=/home/node/.openclaw/extensions/openclaw-gmail-multi
      REPO=https://github.com/boldfield/openclaw-gmail-multi.git
      if [ -d "$PLUGIN_DIR/.git" ]; then
        cd "$PLUGIN_DIR" && git pull --ff-only origin main
      else
        rm -rf "$PLUGIN_DIR"
        mkdir -p /home/node/.openclaw/extensions
        git clone "$REPO" "$PLUGIN_DIR"
      fi
      cd "$PLUGIN_DIR" && npm install --production
  volumeMounts:
    - name: openclaw-data
      mountPath: /home/node/.openclaw
```

## Configuration

The plugin config in `openclaw.json` defines accounts with their `gog` settings. Hook routing is configured separately in the `hooks.mappings` section of `openclaw.json`.

### Plugin config

```json
{
  "plugins": {
    "openclaw-gmail-multi": {
      "accounts": {
        "personal": {
          "email": "brian.oldfield@gmail.com",
          "port": 8788,
          "pubsubPath": "/gmail-pubsub",
          "token": "abc123",
          "gog": {
            "includeBody": true,
            "maxBytes": 20000
          }
        },
        "oldfield": {
          "email": "brian@oldfield.io",
          "port": 8789,
          "pubsubPath": "/gmail-pubsub-oldfield",
          "token": "def456"
        }
      }
    }
  }
}
```

### Hook routing via hooks.mappings

Each `gog` process posts webhook payloads to `http://localhost:<gatewayPort>/hooks/gmail-multi-<accountKey>`. Configure `hooks.mappings` in `openclaw.json` to route these to agent sessions:

```json
{
  "hooks": {
    "mappings": [
      {
        "id": "gmail-personal-classify",
        "match": { "path": "gmail-multi-personal" },
        "action": "agent",
        "wakeMode": "now",
        "model": "claude-haiku-4-5-20251001",
        "thinking": "off",
        "sessionKey": "gmail-personal-classify",
        "messageTemplate": "You are a Gmail classifier...\n\nEmail message ID: {{messages[0].id}}\n...",
        "allowUnsafeExternalContent": true
      },
      {
        "id": "gmail-personal-important",
        "match": { "path": "gmail-important" },
        "action": "agent",
        "wakeMode": "now",
        "model": "claude-sonnet-4-6",
        "sessionKey": "gmail-personal-important",
        "messageTemplate": "Important email flagged by classifier.\n\nEmail ID: {{msgId}}\nAccount: brian.oldfield@gmail.com\n..."
      },
      {
        "id": "gmail-oldfield-classify",
        "match": { "path": "gmail-multi-oldfield" },
        "action": "agent",
        "wakeMode": "now",
        "sessionKey": "gmail-oldfield-triage",
        "messageTemplate": "..."
      }
    ]
  }
}
```

### Config fields

| Field | Required | Description |
|-------|----------|-------------|
| `email` | Yes | Gmail address for the account |
| `port` | Yes | Port for `gog watch serve` (must be unique per account) |
| `pubsubPath` | Yes | HTTP path for GCP Pub/Sub push subscription |
| `token` | Yes | Shared secret for Pub/Sub push validation |
| `gog.includeBody` | No | Include email body in hook payload (default: `true`) |
| `gog.maxBytes` | No | Max bytes for email body (default: `20000`) |

### hooks.mappings fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique identifier for the mapping |
| `match.path` | Yes | Matches the hook path (e.g., `gmail-multi-personal`) |
| `action` | Yes | Action type (e.g., `agent`) |
| `wakeMode` | No | When to wake the session (e.g., `now`) |
| `sessionKey` | Yes | Agent session key |
| `model` | No | Model for the agent session |
| `thinking` | No | Thinking mode (`off`, etc.) |
| `messageTemplate` | Yes | Prompt template with `{{variable}}` substitution |
| `deliver` | No | Delivery options |
| `allowUnsafeExternalContent` | No | Allow untrusted content in templates |

## Disabling built-in hooks.gmail

1. Remove the `hooks.gmail` section from `openclaw.json`
2. Add `OPENCLAW_SKIP_GMAIL_WATCHER=1` to your openclaw deployment env vars
3. Restart the openclaw pod

## Adding a new account

1. **GCP Pub/Sub**: Create a topic and push subscription pointing to `https://<your-host>/<pubsubPath>?token=<token>`
2. **Auth**: Run `gog auth add <email> --services gmail` to complete the OAuth flow
3. **Plugin config**: Add the account to `plugins.openclaw-gmail-multi.accounts` in `openclaw.json`
4. **Hook mappings**: Add `hooks.mappings` entries for the new account's hook path (`gmail-multi-<accountKey>`)
5. **K8s**: Add a service port, container port, and tailscale funnel route for the new account's `pubsubPath`
6. **Apply**: `kubectl apply` and restart the openclaw deployment

## Template variables

Template variables in `hooks.mappings.messageTemplate` come from the `gog` webhook payload and are rendered by openclaw's built-in template engine. Available fields:

| Variable | Description |
|----------|-------------|
| `{{from}}` | Sender address |
| `{{to}}` | Recipient address |
| `{{subject}}` | Email subject |
| `{{date}}` | Email date |
| `{{msgId}}` | Gmail message ID |
| `{{threadId}}` | Gmail thread ID |
| `{{body}}` | Email body (if `includeBody` is enabled) |
| `{{snippet}}` | Gmail snippet |
| `{{messages[0].id}}` | First message ID from the payload |

Dot-path and bracket notation are supported: `{{messages[0].from}}`, `{{headers.subject}}`.

## Security note

Always wrap untrusted email content in boundary markers in your message templates:

```
=== BEGIN UNTRUSTED EMAIL ===
{{body}}
=== END UNTRUSTED EMAIL ===
```

This helps the LLM distinguish between your instructions and the email content, reducing prompt injection risk from malicious emails.

## Environment variables

| Variable | Description |
|----------|-------------|
| `OPENCLAW_GATEWAY_PORT` | Gateway port for hook URLs (default: `18789`) |
| `OPENCLAW_GATEWAY_TOKEN` | Token for authenticating hook calls to the gateway |
| `OPENCLAW_SKIP_GMAIL_WATCHER` | Set to `1` to disable built-in Gmail watcher |

## License

MIT
