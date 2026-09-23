# Plans and user tiers

## Codes

| Code | Auth | Max tasks / sources / steps | Play | Selector | Record | Smart |
|------|------|-----------------------------|------|----------|--------|-------|
| Local | Fake local login | 1 / 1 / 30 | no | no | no | no |
| Free | Server | 3 / 3 / 80 | yes | yes | no | no |
| Pro | Server | unlimited | yes | yes | yes | no |
| Gold | Server (stub) | unlimited | yes | yes | yes | later |

Each tier includes capabilities of lower tiers. Limits are **admin-editable** per plan (`MaxTasks`, `MaxDataSources`, `MaxProcessSteps`; empty = ∞).

## Entities

- `Plan`, `PlanPrice` — admin-managed; no payment gateway yet
- `AppUser.PlanId`, `AppUser.Role` (`User` | `Admin`)
- `DataSource` — user library (independent of processes)
- `ProcessDataSource` — attach/detach only; process delete does not delete library rows

## Limits enforcement

- **MaxTasks** — create process
- **MaxDataSources** — create library source (not per-canvas duplicates)
- **MaxProcessSteps** — step/action node count on canvas save

## APIs

- `GET /api/auth/me` — user + entitlements
- `GET /api/auth/entitlements` — plan flags and limits (with counts)
- `GET/POST/DELETE /api/datasources` — library CRUD
- `POST /api/tasks/{id}/datasources/{dsId}/attach` — link
- `DELETE /api/tasks/{id}/datasources/{dsId}` — unlink (library kept)

## Portal / Admin

- Admin → Plans: edit all three caps
- Admin → Sources: library inventory
- Admin → Migrate: owner-owned processes only; no data sources imported
- Panel → منابع: library list; hard-delete only here / API delete

## Seed accounts

- `guest` / `Guest123!` — Local
- `free` / `Free123!` — Free
- `pro` / `Pro123!` — Pro
- `admin` / `Admin123!` — Admin + Pro
