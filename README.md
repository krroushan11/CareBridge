# CareBridge AI

CareBridge AI is a healthcare and care-management platform. This branch documents Phase 3: Role-Based Access Control (RBAC).

## Phase 3 — Role-Based Access Control (RBAC)

Status: [✓] COMPLETED

### Supported roles

- **Patient** — the safe default for normal registration.
- **Caregiver** — a recognized role without access to another user's medical data unless a future explicit relationship model grants it.
- **Doctor** — a recognized role without access to another user's medical data unless a future explicit relationship model grants it.
- **Admin** — may manage user roles through the protected administration endpoint.

### Role management workflow

Normal registration always creates a `patient` account; clients cannot submit a role to self-assign privileges. An authenticated admin can change a user's role through:

```http
PUT /api/auth/admin/users/:id/role
```

The request body accepts only one of the supported roles. The role migration uses `patient` as the safe baseline for legacy accounts without a valid role.

### JWT and authorization

- Login includes the trusted database role in the signed JWT claims.
- Authentication validates the token payload and rejects missing, invalid, expired, or unsupported-role tokens.
- Centralized `requireRole(...)` middleware supports one or more allowed roles and returns `403` when an authenticated user lacks the required role.
- The admin role-management route requires both JWT authentication and `requireRole("admin")`.

### Resource-level permissions

Patients can access only their own protected account, document, and analysis resources. Document upload, listing, structured extraction, and reviewed care-plan confirmation all require authentication and enforce the authenticated owner's user ID in database queries.

Caregiver and doctor roles currently retain the same owner-only resource boundary. Admins can manage roles, but do not have unrestricted access to users' medical documents or care plans.

### RBAC validation

The RBAC regression tests cover:

- safe patient-only registration and rejection of role mass assignment;
- role inclusion in JWTs and rejection of unsupported role claims;
- missing and invalid JWT rejection;
- single-role and multi-role authorization allow/deny behaviour;
- strict admin role-update validation and safe response fields.

TypeScript validation and the existing backend test suites passed for the Phase 3 implementation.

### Current limitation

Caregiver or doctor access to another patient's data is intentionally not implemented. It requires a separate, explicit, owner-approved care-relationship model with auditable grants and revocation. No role receives implicit cross-user medical-data access.

### Technology

- TypeScript
- Node.js and Express
- PostgreSQL
- JWT-based authentication and role authorization
- REST API

Repository: https://github.com/krroushan11/CareBridge
