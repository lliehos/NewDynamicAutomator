# Plans and user tiers

## Codes

| Code | Auth | Max tasks / sources | Play | Selector | Record | Smart |
|------|------|---------------------|------|----------|--------|-------|
| Local | Fake local login | 1 / 1 | no | no | no | no |
| Free | Server | 3 / 3 | yes | yes | no | no |
| Pro | Server | unlimited | yes | yes | yes | no |
| Gold | Server (stub) | unlimited | yes | yes | yes | later |

Each tier includes capabilities of lower tiers.

## Entities

- `Plan`, `PlanPrice` — admin-managed; no payment gateway yet
- `AppUser.PlanId`, `AppUser.Role` (`User` | `Admin`)

## APIs

- `GET /api/auth/me` — user + entitlements
- `GET /api/auth/entitlements` — plan flags and limits (with counts for server users)
- Task/source create enforces limits; recordings require `CanRecord`

## Portal

- Login: username + password only; guest tip on form; Free users register at `/Panel/Account/Register`
- New registrations get plan from system setting `DefaultRegisterPlan` (default Free); password policy comes from that plan (admin-editable)
- Plan password policy: `MinPasswordLength`, `RequireLetterAndDigit`; self-upgrade targets use `AllowSelfUpgrade`
- Admin area = system settings only (plans, prices, users, events/devices, settings) — no process design/play/record
- Reserved usernames (`ReservedUserNames`) cannot be used when registering or creating users
- Pro/Gold also assignable by admin (must set password matching target plan policy when promoting)

- All process/source CRUD uses `/api/tasks` + canvas; localStorage is cache only
- Device fingerprint recorded on login/register
- Client errors/events: `da-telemetry.js` → `/api/events` (Admin → Events / Devices)

## Seed accounts

- `guest` / `Guest123!` — Local plan (trial tip on login)
- `free` / `Free123!` — demo Free (reserved name)
- `pro` / `Pro123!` — demo Pro (reserved)
- `admin` / `Admin123!` — Admin + Pro (not shown on public login)
