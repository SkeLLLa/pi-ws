# Contributing

Contributions should keep `pi-ws` easy to embed, explicit about security
tradeoffs, and covered by tests or examples when behavior changes.

## Local Setup

```bash
mise install
pnpm install
```

The package targets Node.js `>=22.19.0` and uses pnpm. The `mise` config pins
the local toolchain used by maintainers.

## Common Commands

```bash
pnpm build
pnpm lint
pnpm test
pnpm test:unit:local
pnpm build:docs
pnpm example:chat
```

- `pnpm build` compiles TypeScript and regenerates API docs.
- `pnpm lint` runs type checks, code style checks, and production dependency
  audit checks.
- `pnpm test` runs lint plus unit tests.
- `pnpm build:docs` refreshes generated files under `docs/api/`.

## Pull Request Checklist

- Explain the user-visible behavior change.
- Add or update tests for behavior changes.
- Update README or guide docs when setup, configuration, security, or public API
  behavior changes.
- Regenerate API docs when exported TypeScript types or docs comments change.
- Keep generated `docs/api/*` changes separate from hand-written guide edits
  when possible so reviews stay readable.
- Do not commit secrets, local `.env` files, generated coverage, or temporary
  `.tmp` artifacts.

## Documentation Guidelines

- Put workflow-oriented docs in hand-written guide files.
- Put runnable-example details next to example code in `examples/README.md`.
- Do not manually edit generated API reference files.
- Prefer concrete commands and complete minimal snippets over broad prose.
- State security limits directly; avoid implying that process sandboxing is a
  hard isolation boundary.

## Release Notes

Releases are managed by semantic-release. Use conventional commit messages so
the changelog and versioning can be generated consistently:

```text
feat: add custom route hook
fix: reject invalid artifact metadata
docs: clarify sandbox setup
```

Breaking changes should be called out clearly in the commit body and the pull
request description.

