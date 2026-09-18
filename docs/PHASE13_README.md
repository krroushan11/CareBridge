# Phase 13 — Notifications & Reminders

## Objective

Phase 13 adds a centralized reminder and notification foundation for medication
doses, follow-ups, and medical tests. It reuses the existing PostgreSQL records,
owner-scoped authentication, tracker status rules, and email transport instead
of creating duplicate care-data models.

## Architecture

The backend reminder engine is implemented in
`backend/src/services/reminderEngine.ts`. It creates deduplicated notification
records from:

- `medication_doses` joined to active `medications`
- active `follow_ups`
- active `medical_tests`

The engine runs as one interval scheduler started by
`backend/src/server.ts`. It generates due/upcoming records, then processes
eligible pending email deliveries. Failures are isolated per notification and
persisted as delivery status rather than crashing the server.

## Reminder categories

### Medicine reminders

Medication reminders use the existing dose schedule and include the medication
name, scheduled timestamp, owner, and a generated reminder body. Scheduled
doses are deduplicated by owner, source dose, and scheduled time.

### Follow-up reminders

Follow-up reminders use `appointment_date` with `due_date` as a fallback.
Only `pending` and `scheduled` records with dates are eligible. Completed,
cancelled, and missed records are excluded.

### Test reminders

Medical-test reminders use `scheduled_date` and include the test name and
available instructions. Only `pending` and `scheduled` records with dates are
eligible.

## Notification persistence and status

The migration
`backend/database/migrations/20260921_phase13_notifications.sql` adds the
owner-scoped `notifications` table. It records:

- notification kind and source record
- title and body
- scheduled time and deduplication key
- unread/read state and `read_at`
- delivery state: `pending`, `sent`, `failed`, or `skipped`
- `delivered_at` and safe delivery error text

The unique `(user_id, dedupe_key)` constraint prevents duplicate scheduled
notifications.

## Scheduling

`startReminderScheduler()` starts one process-local interval. Repeated starts
return the existing timer, and `stopReminderScheduler()` is available for
tests and controlled shutdown. The scheduler is a backend reliability
improvement; foreground browser polling remains available as a user-facing
fallback.

## Email notifications

`backend/src/services/emailService.ts` retains the existing password-reset
email flow and adds `sendReminderEmail()`. Reminder email delivery is enabled
only when:

- `EMAIL_REMINDERS_ENABLED=true`
- `EMAIL_USER` is configured
- `EMAIL_PASS` is configured

Missing configuration safely transitions a notification to `skipped`; the
application does not crash. SMTP/provider credentials are never hard-coded.

## Push notifications

The Phase 13 push foundation stores owner-scoped browser subscriptions and
provides service-worker handling where configured. It does not claim real push
delivery without a Web Push provider and VAPID configuration.

Required production configuration remains external:

- HTTPS in the deployed frontend
- browser notification permission
- VAPID public/private keys
- a configured Web Push delivery provider

## APIs

Existing authenticated reminder feeds remain available:

- `GET /api/reminders/upcoming`
- `GET /api/follow-ups/reminders/upcoming`
- `GET /api/medical-tests/reminders/upcoming`

New authenticated notification APIs:

- `GET /api/notifications`
- `GET /api/notifications/unread`
- `PATCH /api/notifications/:id/read`

Push subscription APIs, when the push foundation is enabled, are owner-scoped
and use the existing bearer-token authentication.

- `POST /api/notifications/push-subscriptions`
- `DELETE /api/notifications/push-subscriptions/:id`

## Frontend reminder behavior

`frontend/src/main.js` now:

- clears existing reminder intervals before dashboard rerenders and logout
- invalidates stale in-flight polling work
- enforces the page mute state
- reports reminder polling failures in the dashboard
- caches medication, follow-up, and medical-test requests per render

The existing browser `Notification` API and reminder sound behavior are
preserved. They remain foreground, browser-tab behavior rather than a
replacement for server delivery.

## Environment variables

Documented in `backend/.env.example`:

- `EMAIL_USER`
- `EMAIL_PASS`
- `EMAIL_REMINDERS_ENABLED`
- `REMINDER_INTERVAL_MS`
- `VITE_VAPID_PUBLIC_KEY` (frontend, optional)

Push provider/VAPID settings are intentionally not populated with fake values.
They must be supplied through deployment configuration before production push
delivery is enabled.

## Testing and validation

Focused Phase 13 backend tests are in
`backend/test/reminderEngine.test.ts`. Existing tracker and medication tests
remain unchanged.

Frontend reminder behavior is covered by
`frontend/test/reminderUtils.test.js`; Phase 12 tracker coverage remains in
`frontend/test/trackerUtils.test.js`.

Validation commands:

```powershell
cd frontend
npm run test:reminders
npm run test:trackers
npm run build

cd ..\backend
npm run build
npx tsx --test test/reminderEngine.test.ts
npx tsx --test test/followUpTracking.test.ts
npx tsx --test test/medicationManagement.test.ts
```

## Status and limitations

- **[IMPLEMENTED]** Centralized reminder generation for medicines, follow-ups,
  and medical tests.
- **[IMPLEMENTED]** Owner-scoped notification persistence, deduplication,
  read state, and delivery status.
- **[IMPLEMENTED]** Singleton backend scheduler and failure-isolated email
  delivery path.
- **[IMPLEMENTED]** Frontend timer lifecycle, mute enforcement, request
  caching, and polling error handling.
- **[PARTIALLY IMPLEMENTED]** Browser notifications remain foreground-only;
  background delivery requires push provider configuration.
- **[REQUIRES CONFIGURATION]** SMTP credentials and
  `EMAIL_REMINDERS_ENABLED=true` are required for reminder email delivery.
- **[REQUIRES CONFIGURATION]** HTTPS, VAPID keys, and a Web Push provider are
  required for production push delivery.
