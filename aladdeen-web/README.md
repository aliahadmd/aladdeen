# Aladdeen Web

The official landing page and private R2-backed macOS download service for Aladdeen.

## Stack

- React 19, Vite, and Tailwind CSS 4
- Hono on Cloudflare Workers
- Private Cloudflare R2 bucket binding for streamed installers
- Strict TypeScript, ESLint, Vitest, and Workers-runtime integration tests

The project intentionally does not include D1, authentication, billing, analytics, forms, or a client-side router.

## Development

Requires Node.js 22.22+ and pnpm 11.5+.

```bash
pnpm install
pnpm cf-typegen
pnpm dev
```

The R2 binding uses local Miniflare storage during development and tests.

## Verification

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm check
pnpm peers check
pnpm audit --audit-level high
```

`pnpm check` regenerates Worker binding types, runs the complete verification suite, creates the production build, and performs a Wrangler deployment dry-run.

## Cloudflare

`wrangler.json` is the configuration source of truth. The production Worker:

- serves static assets globally;
- invokes Worker code first only for `/api/*` and `/download/*`;
- streams allow-listed installers from the private `aladdeen-downloads` R2 bucket;
- routes the production hostname through `aladdeen.aliahad.com`.

Deploy only after the versioned installer objects listed in `src/shared/releases.ts` have been uploaded and verified:

```bash
pnpm check
pnpm deploy
```
