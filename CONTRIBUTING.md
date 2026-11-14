# Contributing to LiResearch

Welcome, and thank you for considering contributing to LiResearch.

LiResearch is open-source software created by [Ali Ahad](https://aliahad.com) and licensed under the [GNU General Public License v3.0 (GPLv3)](LICENSE).

## Ways to contribute

- **Report bugs & suggest features:** Open an issue on [GitHub Issues](https://github.com/LiLabsAI/LiResearch/issues) with clear reproduction steps and your macOS / app version.
- **Submit pull requests:** Fork the repository, create a focused branch from `main`, keep changes well-tested, and open a pull request describing the motivation and verification you ran.
- **Build & extend locally:** See [DEVELOPMENT.md](DEVELOPMENT.md) for local setup, architecture notes, and packaging details.

## Running checks before opening a PR

Desktop app (from the repository root):

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm check:release
pnpm check:spreadsheets
pnpm check:presentations
```

Website and download worker (under `liresearch-web/`):

```bash
pnpm --dir liresearch-web run check
```

## Licensing & attribution

- Original LiResearch code carries the copyright notice `Copyright © 2026 Ali Ahad` and is released under **GPL-3.0-only** ([LICENSE](LICENSE)).
- By submitting a contribution (pull request, patch, or commit) to this repository, you agree that your contribution is licensed to the project and all downstream recipients under the **GNU General Public License v3.0 (GPLv3)**.
- Any distributed forks, modifications, or derivative works of LiResearch must also be licensed under GPLv3 with complete corresponding source code and attribution preserved.
- Please do not introduce dependencies whose licenses conflict with GPLv3; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for third-party component notices.
