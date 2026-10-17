# Webautomator encryption & .watm (design notes)

## Implemented now
- AES-256-GCM via Web Crypto (`wwwroot/js/da-crypto.js`; the extension bundles the same file at
  `extension-global/lib/da-crypto.js`)
- Single **global key** material (MVP) — rotating it invalidates all local blobs and `.watm` files
- Process list + user profile stored in `localStorage` as `mrbt1:<base64>` — the prefix is deliberately
  NOT renamed, because it addresses data already written on every machine
- Export/import uses `.watm` (ciphertext of the same JSON payload), header `WATM/1`
- Legacy `.mrbt` files still import: the decoder accepts the old `MRBT/1` header too. Nothing is written
  in the old format any more.
- A legacy plain-text JSON export is still accepted once, and re-saved as `.watm`.

## Import targets
- **Server-backed process** → the file is `PUT` to `/api/tasks/{id}/canvas` first, with the row's current
  revision as `baseUpdatedAtUtc`. A run in progress (409 `playing`) or a simultaneous edit (409
  `conflict`) is reported to the user instead of being overwritten silently. The local cache is only
  updated after the server accepted the file.
- **Local-only process** → the encrypted local cache is written directly.

## Future (not built)
1. **UserPlanKey** — issued after purchase; `expiresAt` (e.g. +30 days). Renewal extends expiry.
2. **DEK per process** — random data key encrypts payload; DEK is wrapped with UserPlanKey.
3. **GlobalSurasKey wrap** — second wrap of the same DEK so Suras / interchange can open any shared process without the user key.
4. **Sharing** — wrap DEK for recipient’s UserPlanKey (or temporary share wrap). Recipient unwraps DEK → decrypts payload.
5. Expired UserPlanKey → local decrypt fails unless GlobalSurasKey (or renewed plan) unwraps DEK.

This dual-wrap envelope is implementable and matches the product goals (paid isolation + future sharing).
