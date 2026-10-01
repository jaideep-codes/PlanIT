# PlanIT agent rules

Read `docs/architecture.md`, `docs/security.md` and `docs/development.md` before changing code.
Work one roadmap phase at a time (`docs/roadmap.md`) and stop for review at the end of each phase.

## Non-negotiable

- Every user-owned read and write is scoped by the **server-side session's** user ID. Never trust
  a user ID from a request body, query, path or AI model output. Cross-user access returns 404.
- Never expose `passwordHash`. Public profiles are assembled server-side from permitted fields.
- Never log passwords, OTPs, tokens, OAuth secrets, the PlanIT-managed AI key or BYOK keys.
- The BYOK key is never stored anywhere, and never sent to the PlanIT backend.
- AI never accesses the database directly. It reads through owner-scoped tools and only
  proposes changes. Execution requires explicit user approval of the exact proposal.
- No fake APIs, mock data, placeholder business logic or fake integrations. Unbuilt features show
  an honest "not available yet" state.
- Focus timing is server-authoritative (timestamps), not `setInterval`. `localStorage` is not a
  database.
- External integrations, MCP and features on the deferred list are built only when explicitly
  instructed.

## Conventions

- ESM everywhere. API imports use `.js` extensions.
- Shared Zod schemas live in `@planit/shared`; compile-time contracts in `@planit/types`.
- Controllers handle transport only; services hold business rules; repositories hold queries.
- Throw `AppException` for expected errors.
- Hand-written CHECK constraints and partial indexes go in migration SQL. Never edit applied
  migrations.
- Use `pnpm run test`, not `pnpm test`.
- Files must use LF line endings.
- Record non-obvious decisions in `docs/decisions.md`.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
