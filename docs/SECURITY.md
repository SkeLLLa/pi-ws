# Security Guide

`pi-ws` runs local coding-agent subprocesses for remote WebSocket clients. Treat
it as an application component that needs explicit access control and isolation,
not as a standalone security boundary.

## Default Security Posture

- The server binds to `127.0.0.1` by default.
- Authentication is not enabled unless you add auth hooks or configure the
  reference token hook.
- Each `/ws/pi` connection gets a separate Pi subprocess.
- Artifact paths are not exposed to browsers; clients receive safe artifact
  metadata and binary file contents.
- Process sandbox mode constrains cwd, `HOME`, `TMPDIR`, and selected
  environment variables, but it is not OS-enforced isolation.

## Responsibilities For Applications

- Require authentication before exposing `/ws/pi` to untrusted users.
- Keep provider API keys on the server; never send them to browser clients.
- Prefer HTTPS/WSS or a trusted reverse proxy for non-local deployments.
- Limit who can reach the bridge at the network layer.
- Decide what directories the agent can read or write.
- Review generated artifacts before treating them as trusted content.
- Log enough request/session metadata for incident review without leaking
  secrets.

## Authentication

Use `createStaticTokenAuthHook()` only when a shared token is enough for your
deployment. Larger applications should integrate `onRequest` or `onAuth` hooks
with their existing session, user, or service-to-service auth.

Browser clients that cannot send custom WebSocket upgrade headers can use the
reserved first message:

```json
{ "token": "change-me", "type": "pi_ws_auth" }
```

For HTTP routes added through `handle()`, wrap handlers with
`protectHttpHandler()` or enforce auth in your own route handler.

## Sandbox Modes

- `off` runs Pi with the configured process environment and cwd.
- `process` creates per-session directories and controls selected environment
  variables. This is useful hygiene, not a hard security boundary.
- `system` runs Pi through an external wrapper such as `bwrap` or `firejail`.
  Use this when you need OS-enforced filesystem or process isolation.

Recommended defaults for exposed deployments:

```ts
const bridge = new PiWs({
  sandbox: {
    mode: 'system',
    envPolicy: 'minimal',
    allowReadDirs: [],
    allowWriteDirs: ['./.pi-ws/scratch'],
    denyServerDirectory: true,
  },
});
```

The exact `system` wrapper arguments are host-specific. Test them on the target
machine and make sure the Pi command, temporary directories, and artifact
directory remain usable.

## Deployment Checklist

- Bind to a private interface unless the service is intentionally public.
- Put TLS at the bridge or at a reverse proxy.
- Enable auth for `/ws/pi` and private HTTP routes.
- Use short-lived or scoped provider credentials where possible.
- Set `PI_WS_SANDBOX_ENV_POLICY=minimal` or an explicit allowlist.
- Configure artifact size limits for your environment.
- Run dependency and vulnerability checks through `pnpm run lint:packages`.
- Monitor process count, disk usage, artifact directories, and logs.

## Reporting Issues

Please report vulnerabilities privately when possible. If the hosting platform
does not provide private vulnerability reporting for this repository, contact
the maintainer before opening a public issue with exploit details.

