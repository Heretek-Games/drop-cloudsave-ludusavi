# Ludusavi Cloud Save Resolver

Ludusavi-backed cloud save path resolution plugin.

The resolver fetches the upstream
[Ludusavi manifest](https://github.com/mtkennerly/ludusavi-manifest) once per
server process (retried on failure), expands its `<placeholder>` path tokens
with the host environment, and falls back to heuristic patterns for titles the
manifest does not cover.

## Build

```sh
npm ci
npm run build
npm test
npm run typecheck
```
