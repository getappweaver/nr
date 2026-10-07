# Nostr Radar working instructions

Follow the [core instructions](../../AGENTS.md). Read local `README.md` and relevant `docs/` before editing a module. Update those docs when behavior or architecture changes; use Memory for committed code/Markdown discovery when indexed.

Only create or edit `AGENTS.md` when the user explicitly asks for instruction changes. Do not regenerate legacy bottom-up artifacts during ordinary maintenance.

## Release workflow

Use these steps when the user explicitly requests publishing the plugin:

1. Go to the plugin folder
1. run `git init`
1. run `git add .`
1. run `git commit -m "Initial commit"`
1. run `git tag -a v1.0.0 -m "Initial release"`
1. run `ngit init --name "appweaver-${alias}-plugin" --description "${description}" -d`
1. run `git push origin v1.0.0`
1. run `git push origin main`
1. run `cd ../..` to go back to the root folder
1. run `bun run plugin:publish` to publish the plugin to Nostr
