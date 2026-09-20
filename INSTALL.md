# dsh-deep-whale Installation

The one-line install pulls the skin manager and both Deep Whale skins straight from this repository's `main` (per-subdirectory GitHub specs; pnpm ≥ 9) — no clone and no AI assistance required. **The packages are not published on npm yet**; `@wjingshan/*` are their intended npm names.

> **Distribution boundary:** these instructions are only for standalone environments that run DSH directly. If `@linxin666/dsh-web-all` (dsh-web) is installed, stop here and install dsh-web's adapted `maid-atelier-wj` and `orca-link-wj` through its own skin center/installer. Do not add this repository's standalone packages to the same profile.

> AI assistants: follow this file as the installation guide. A plain install is just the one-liner below; use the bundled `.agents/skills/dsh-skin-install` skill only for legacy migration, local development builds, specified-commit testing, or diagnosis.

## Linux / macOS / WSL

```sh
dsh plugin --profile web add '@smalltailqwq/dsh-client-ui-skin-deep-whale-manager'
dsh plugin --profile web add 'github:wjingshan/dsh-deep-whale#path:/maid-atelier'
dsh plugin --profile web add 'github:wjingshan/dsh-deep-whale#path:/orca-link'
```

## PowerShell

```powershell
dsh plugin --profile web add '@smalltailqwq/dsh-client-ui-skin-deep-whale-manager'
dsh plugin --profile web add 'github:wjingshan/dsh-deep-whale#path:/maid-atelier'
dsh plugin --profile web add 'github:wjingshan/dsh-deep-whale#path:/orca-link'
```

Restart DSH once (first package addition). On that restart the skin manager detects "two skins enabled at once" and atomically falls back to the official default, so skins can never stack; then choose a skin in Settings → Skin Management. Later switches hot-reload without a restart.

Update with:

```sh
dsh plugin --profile web update
```

```powershell
dsh plugin --profile web update
```

## Migrating from the old placeholder scope

Installations made from GitHub before `0.1.3` use `@dsh-external/*` dependency keys. That scope was only a source-level placeholder for this project. Remove all three old keys before adding the packages above; otherwise DSH can retain duplicate plugin identities.

```sh
dsh plugin --profile web remove '@dsh-external/dsh-client-ui-skin-orca-link'
dsh plugin --profile web remove '@dsh-external/dsh-client-ui-skin-maid-atelier'
dsh plugin --profile web remove '@dsh-external/dsh-client-ui-skin-deep-whale-manager'
```

Then run the one-line install above and restart DSH once. Existing skin preferences remain keyed by skin id (`maid-atelier-wj` / `orca-link-wj`) and are not renamed.

See [README.md](README.md) ([README.en.md](README.en.md)) for the mutual-exclusion explanation, standalone/local-development install path, verification and troubleshooting.

The bundled `.agents/skills/dsh-skin-install` skill is for legacy-package migration, local development builds, specified-commit testing, or diagnosis — not for a regular first install.


## Coexisting with the upstream packages

This fork's plugin identity is deliberately separated from upstream: the npm package name (`@wjingshan/*`),
`skin.json.id` (`maid-atelier-wj` / `orca-link-wj`), `wiring.id` and `bodyAttr` all differ, so both
distributions can be installed into one profile without either skin shadowing the other. The separation is
reapplied after every upstream sync by `scripts/apply-fork-rename.py`.

The skin manager is generic and discovers skins through their `skin.json`, so the manager package published by
the upstream project (same `…-deep-whale-manager` suffix, different npm scope) manages this fork's skins as well.
This repository ships no manager of its own, so there is no second manager identity to avoid.
See the coexistence section in [README.md](README.md) for the identity table.
