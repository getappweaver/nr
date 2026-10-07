# Nr plugin (nr)

Nostr Radar fetches posts from followed authors, classifies them for personal relevance, and provides a review interface.

**Command:** `/nr`

---

## Classifier provider

NR declares use of the `system-one:v1` capability for classifier mode. It builds typed topic, mood, language, and relevance questions from NR preferences and sends them, with the event/thread/reference state, through `PluginContext.capabilities`. The System One provider owns the API endpoint, key, retries, and protocol validation; NR maps validated answers to its event classification.

Install the System One provider and configure its key once with `/systemone settings --api-key <key>`. NR no longer requests the System One key or endpoint in its settings. Legacy NR database values are unused and may be cleared with the regular NR settings reset if desired. Document contents/event text and preferences sent by NR are also visible to the configured inference provider.

NR keeps its candidate catalogs, batching, question wording, confidence interpretation, and skip policy. Classifier mode fails with a clear error if no provider is installed or provider selection is ambiguous; it does not silently switch to the text model.

Classifier requests inherit the default model configured in System One settings. A cancelled NR evaluation discards the provider result when it arrives.

See PLUGINS.md in the repo root for the full plugin author guide.

After you change structure or behavior, refresh `__BOTTOMUP.md` for this plugin directory (appweaver-file `bottomup` tools; root file uses `scope_root: true`).

## Architecture

See [local architecture and source map](docs/architecture.md).

## Local modules

- [types](types/README.md)
- [scripts](scripts/README.md)
- [commands](commands/README.md)
