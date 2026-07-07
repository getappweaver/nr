# How to add a new agent

After creating a new plugin with `bun run plugin:new`, you need to publish the plugin to Nostr.

Keep `__BOTTOMUP.md` in the plugin root up to date when layout or responsibilities change (appweaver-file bottom-up docs; `scope_root: true` is set in the template).

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
