# Morobot encryption & .mrbt (design notes)

## Implemented now
- AES-256-GCM via Web Crypto (`wwwroot/js/da-crypto.js`)
- Single **global key** material (MVP) — rotating it invalidates all local blobs and `.mrbt` files
- Process list + user profile stored in `localStorage` as `mrbt1:<base64>`
- Export/import uses `.mrbt` (ciphertext of the same JSON payload)

## Future (not built)
1. **UserPlanKey** — issued after purchase; `expiresAt` (e.g. +30 days). Renewal extends expiry.
2. **DEK per process** — random data key encrypts payload; DEK is wrapped with UserPlanKey.
3. **GlobalSurasKey wrap** — second wrap of the same DEK so Suras / interchange can open any shared process without the user key.
4. **Sharing** — wrap DEK for recipient’s UserPlanKey (or temporary share wrap). Recipient unwraps DEK → decrypts payload.
5. Expired UserPlanKey → local decrypt fails unless GlobalSurasKey (or renewed plan) unwraps DEK.

This dual-wrap envelope is implementable and matches the product goals (paid isolation + future sharing).
