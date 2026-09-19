# CareBridge AI - Phase 14: Family & Caregiver Coordination

## 1. Overview

Phase 14 adds patient-scoped family and caregiver coordination to CareBridge
AI. A patient can invite an existing caregiver account, choose least-privilege
permissions, share verified care information, and revoke access. A caregiver
must explicitly accept an invitation before any patient data is available.

## 2. Objectives

- Create a safe caregiver invitation and acceptance flow.
- Keep all access scoped to one patient-caregiver relationship.
- Reuse the existing verified care plan, follow-up, medical-test, and medication
  records.
- Provide a caregiver dashboard without changing the existing patient and
  clinician dashboard flows.
- Enforce permissions and revocation on the server, not only in the UI.

## 3. Implemented Features

- **[IMPLEMENTED]** Authenticated patient invitations.
- **[IMPLEMENTED]** Caregiver accept and reject actions.
- **[IMPLEMENTED]** Explicit permissions for care-plan, task, follow-up,
  medical-test, and medication views.
- **[IMPLEMENTED]** Patient-scoped shared care-plan and task APIs.
- **[IMPLEMENTED]** Caregiver dashboard with invitation and relationship state.
- **[IMPLEMENTED]** Patient permission management and access revocation.
- **[IMPLEMENTED]** Owner and relationship authorization checks.

## 4. Caregiver Invitation Flow

`POST /api/caregivers/invite` requires a bearer-authenticated patient. The
request accepts a caregiver email and an explicit permission list. The server
requires an existing user with the `caregiver` role, rejects self-invites,
prevents duplicate pending or accepted relationships, and creates a `pending`
relationship.

An invitation alone never grants access. The intended caregiver must use:

- `POST /api/caregivers/:id/accept`
- `POST /api/caregivers/:id/reject`

Only the caregiver identified by the stored relationship can accept or reject
it. Expired, revoked, or already-processed invitations cannot be accepted.

## 5. Permission Model

The migration
`backend/database/migrations/20260922_phase14_caregiver_coordination.sql`
stores an explicit JSON permission list on each relationship. Supported
permissions are:

- `view_care_plan`
- `view_tasks`
- `update_tasks`
- `view_follow_ups`
- `view_medical_tests`
- `view_medications`

The patient can inspect permissions with
`GET /api/caregivers/:id/permissions` and update them with
`PATCH /api/caregivers/:id/permissions`. Caregiver requests require an
accepted, unexpired relationship and the relevant permission.

## 6. Shared Care Plan

`GET /api/caregivers/:id/care-plan` returns the latest verified care plan
owned by the patient when the relationship permits `view_care_plan`. It reuses
the existing `verified_care_plans` data and does not create a duplicate
care-plan model. Draft or unverified extraction data is not shared.

## 7. Shared Recovery Tasks

`GET /api/caregivers/:id/tasks` returns only the permitted patient resources:

- Existing `follow_ups`
- Existing `medical_tests`
- Existing `medications`

Follow-up and medical-test status updates are available through:

- `PATCH /api/caregivers/:id/follow-ups/:taskId`
- `PATCH /api/caregivers/:id/medical-tests/:taskId`

These updates require `update_tasks` plus the matching view permission and
still constrain the underlying record by the patient owner ID.

## 8. Caregiver Dashboard

The existing single-page frontend in `frontend/src/main.js` routes users with
the `caregiver` role to a caregiver dashboard. It shows:

- Pending invitations with accept/reject actions.
- Connected patient relationships.
- Permission state.
- Shared care-plan availability.
- Permitted follow-up, medical-test, and task information.
- Revoked and rejected relationship states.

Patient users see a family and caregiver section in the existing care
management dashboard for invitations, permission updates, and revocation.

## 9. Access Revocation

`POST /api/caregivers/:id/revoke` is patient-owner-only. It marks a pending or
accepted relationship as `revoked`. Every shared-resource authorization query
requires `status = 'accepted'`, a non-revoked relationship, a non-expired
relationship, and the required permission. Revoked access therefore fails
server-side immediately and requires a new invitation and acceptance.

## 10. API Endpoints

All caregiver routes use the existing bearer-token middleware:

- `GET /api/caregivers`
- `POST /api/caregivers/invite`
- `POST /api/caregivers/:id/accept`
- `POST /api/caregivers/:id/reject`
- `GET /api/caregivers/:id/permissions`
- `PATCH /api/caregivers/:id/permissions`
- `POST /api/caregivers/:id/revoke`
- `GET /api/caregivers/:id/care-plan`
- `GET /api/caregivers/:id/tasks`
- `PATCH /api/caregivers/:id/follow-ups/:taskId`
- `PATCH /api/caregivers/:id/medical-tests/:taskId`

## 11. Database Changes

The migration creates `caregiver_relationships` with:

- Patient and caregiver foreign keys to the existing `users` table.
- Invitation status: `pending`, `accepted`, `rejected`, or `revoked`.
- Explicit permissions and expiry timestamp.
- Acceptance, rejection, and revocation timestamps.
- Patient/caregiver indexes.
- A partial unique index preventing duplicate pending or accepted
  relationships.

The migration is additive and must be applied to each deployed database
before the new API routes are enabled. No destructive migration was executed.

## 12. Security and Authorization

The implementation uses the existing `authenticateToken` middleware and signed
JWT identity. It does not trust client-supplied patient, caregiver, or
relationship ownership claims. Authorization checks cover:

- Authentication and patient-only invitation creation.
- Intended-caregiver acceptance and rejection.
- Patient-only permission management and revocation.
- Accepted relationship status and expiry.
- Required permission for each shared resource.
- Patient owner ID on every shared query and update.
- Cross-patient access denial.

No credentials, tokens, private keys, API keys, or patient data were added.

## 13. Automated Tests

Phase 14 backend coverage is in
`backend/test/caregiverCoordination.test.ts` and covers:

- Authorized invitation creation.
- Unauthorized invitation acceptance.
- Patient-scoped permission changes.
- Patient-scoped revocation.
- Permission-gated shared task access.

Frontend helper coverage is in `frontend/test/caregiverUtils.test.js` and
covers explicit permission checks and relationship-state labels.

## 14. Build and Test Results

Executed successfully:

- `cd backend; npm run build`
- `cd backend; npx tsx --test test/caregiverCoordination.test.ts`
  - 8 passed, 0 failed
- `cd backend; npx tsx --test test/*.test.ts`
  - 111 passed, 0 failed
- `cd frontend; npm run test:caregivers`
  - 2 passed, 0 failed
- `cd frontend; npm run test:reminders`
  - 5 passed, 0 failed
- `cd frontend; npm run test:trackers`
  - 10 passed, 0 failed
- `cd frontend; npm run build`
  - passed
- `git diff --check`
  - passed

## 15. Known Limitations

- Invitations currently target an existing `caregiver`-role account by email.
  Account provisioning and invitation email delivery are outside this phase.
- The caregiver dashboard currently provides shared information and safe
  status-update API foundations; it does not provide a separate notification
  inbox for relationship events.
- The migration must be applied to a deployed database before production use.
- Live browser verification and a real multi-user deployment test were not
  performed during this implementation validation.

## 16. Configuration Requirements

No new secret or provider configuration is required. Production deployments
must apply the Phase 14 migration and provision caregiver users through the
existing account/role administration flow.

**[PARTIALLY VERIFIED]** The local workspace has the configured database and
JWT prerequisites, the `caregiver_relationships` schema, and at least one
caregiver-role account. Production migration application and caregiver-account
provisioning cannot be verified here because the production deployment and its
authorized administrator context are not available. No production verification
is claimed.

## 17. Phase 14 Status

**[IMPLEMENTED]** Caregiver invitation, acceptance/rejection, explicit
permissions, shared verified care-plan access, shared task access, caregiver
dashboard routing, and server-side revocation.

**[PARTIALLY IMPLEMENTED]** Caregiver-safe task status updates are available
for follow-ups and medical tests; broader care-plan editing is intentionally
not exposed because the existing verified care-plan workflow is owner-controlled.

**[REQUIRES CONFIGURATION]** The additive database migration must be applied,
and caregiver accounts must exist before invitations can be created.

**[NOT IMPLEMENTED]** Email delivery for invitations, real-time relationship
notifications, and live multi-user browser verification.
