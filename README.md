# openclaw-gmail-multi

Multi-account Gmail integration plugin for [OpenClaw](https://github.com/boldfield/openclaw). Replaces the built-in `hooks.gmail` with a flexible, prompt-driven pipeline that supports multiple Gmail accounts. Delegates to [`gog`](https://github.com/boldfield/gog) CLI for OAuth, Gmail Watch API, and Pub/Sub handling.

Each configured account gets its own `gog gmail watch serve` child process. Incoming emails are routed through configurable hook handlers that render prompt templates and dispatch them to agent sessions — enabling multi-stage LLM pipelines (e.g., Haiku classifies, Sonnet handles).

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

Add the plugin config to your `openclaw.json`:

```json
{
  "plugins": {
    "openclaw-gmail-multi": {
      "accounts": {
        "personal": {
          "email": "user@gmail.com",
          "port": 8788,
          "pubsubPath": "/gmail-pubsub-personal",
          "token": "your-pubsub-validation-token",
          "gog": {
            "includeBody": true,
            "maxBytes": 20000
          },
          "hooks": {
            "incoming": {
              "sessionKey": "gmail-classifier-personal",
              "model": "claude-haiku-4-5-20251001",
              "prompt": "You received a new email on {{account.email}}.\n\nFrom: {{from}}\nSubject: {{subject}}\nDate: {{date}}\n\n=== BEGIN UNTRUSTED EMAIL ===\n{{body}}\n=== END UNTRUSTED EMAIL ==="
            }
          }
        },
        "work": {
          "email": "user@company.com",
          "port": 8789,
          "pubsubPath": "/gmail-pubsub-work",
          "token": "another-validation-token",
          "hooks": {
            "incoming": {
              "sessionKey": "gmail-classifier-work",
              "model": "claude-haiku-4-5-20251001",
              "prompt": "New work email on {{account.email}}.\n\nFrom: {{from}}\nSubject: {{subject}}\n\n=== BEGIN UNTRUSTED EMAIL ===\n{{body}}\n=== END UNTRUSTED EMAIL ==="
            }
          }
        }
      }
    }
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
| `hooks.<name>.sessionKey` | Yes | Agent session key for dispatching prompts |
| `hooks.<name>.prompt` | Yes | Prompt template (supports `{{variable}}` substitution) |
| `hooks.<name>.model` | No | Model override for the agent session |
| `hooks.<name>.thinking` | No | Thinking mode override |

## Disabling built-in hooks.gmail

1. Remove the `hooks.gmail` section from `openclaw.json`
2. Add `OPENCLAW_SKIP_GMAIL_WATCHER=1` to your openclaw deployment env vars
3. Restart the openclaw pod

## Adding a new account

1. **GCP Pub/Sub**: Create a topic and push subscription pointing to `https://<your-host>/<pubsubPath>?token=<token>`
2. **Auth**: Run `gog auth add <email> --services gmail` to complete the OAuth flow
3. **Config**: Add the account to the `plugins.openclaw-gmail-multi.accounts` section in `openclaw.json`
4. **K8s**: Add a service port, container port, and tailscale funnel route for the new account's `pubsubPath`
5. **Apply**: `kubectl apply` and restart the openclaw deployment

## Pipeline examples

### Two-stage classifier pattern

**Stage 1 — Haiku classifies:**

```json
{
  "incoming": {
    "sessionKey": "gmail-classifier",
    "model": "claude-haiku-4-5-20251001",
    "prompt": "You are an email classifier for {{account.email}}.\n\nClassify this email and take action:\n- IMPORTANT: Forward to the important-handler hook via curl\n- ROUTINE: Mark as read\n- SPAM: Archive and mark as read\n\nFrom: {{from}}\nSubject: {{subject}}\nDate: {{date}}\nMessage ID: {{msgId}}\n\n=== BEGIN UNTRUSTED EMAIL ===\n{{body}}\n=== END UNTRUSTED EMAIL ===\n\nTo forward to the important handler:\ncurl -X POST http://localhost:18789/hooks/gmail-multi/personal/important \\\n  -H 'Content-Type: application/json' \\\n  -d '{\"msgId\": \"{{msgId}}\", \"from\": \"{{from}}\", \"subject\": \"{{subject}}\", \"body\": \"...summary...\"}'"
  }
}
```

**Stage 2 — Sonnet handles important emails:**

```json
{
  "important": {
    "sessionKey": "gmail-important",
    "model": "claude-sonnet-4-6",
    "prompt": "An important email was flagged for {{account.email}}.\n\nFrom: {{from}}\nSubject: {{subject}}\nMessage ID: {{msgId}}\n\n{{body}}\n\nPlease draft a summary and notify via Slack."
  }
}
```

## Template variables

All fields from the `gog` webhook payload are available at the top level. Additionally:

| Variable | Description |
|----------|-------------|
| `{{account.email}}` | Email address of the account |
| `{{account.key}}` | Account key from config (e.g., `personal`) |
| `{{from}}` | Sender address |
| `{{to}}` | Recipient address |
| `{{subject}}` | Email subject |
| `{{date}}` | Email date |
| `{{msgId}}` | Gmail message ID |
| `{{threadId}}` | Gmail thread ID |
| `{{body}}` | Email body (if `includeBody` is enabled) |
| `{{snippet}}` | Gmail snippet |

Dot-path and bracket notation are supported: `{{messages[0].from}}`, `{{headers.subject}}`.

Missing variables resolve to an empty string — templates never throw on undefined values.

## Security note

Always wrap untrusted email content in boundary markers in your prompts:

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
