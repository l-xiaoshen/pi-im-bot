# onebot-sdk

Generated OneBot 11 SDK using [Hey API](https://heyapi.dev/).

## Generate

```bash
bun run generate
```

This compiles the TypeSpec spec, generates the SDK into `src/generated`, and
applies a small post-generation patch so `ActionName` keeps autocomplete while
still accepting custom action names:

```ts
export type ActionName = (typeof ActionName)[keyof typeof ActionName] | (string & {})
```

The generated client is intentionally not re-exported directly. Wrap it in a
higher-level layer before exposing it.

## Generated SDK

The spec defines explicit routes for every standard action, so the generated SDK
includes typed operations such as `httpActionsSendPrivateMsg` and
`httpActionsGetLoginInfo`. The generic `/{action}` route remains available for
custom actions.

## Typecheck

```bash
bun run typecheck
```
