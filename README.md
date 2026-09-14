\# CareBridge AI



AI-enabled healthcare and care management platform.



\## Phase 1 — Project Foundation



Phase 1 establishes the core foundation of the CareBridge AI project, including the repository structure, frontend and backend setup, database foundation, authentication, documentation, and development environment.



\### Completed Scope



\- GitHub repository and project structure

\- Frontend setup

\- Backend API setup

\- Docker and environment configuration

\- PostgreSQL database schema

\- Authentication and authorization foundation

\- API documentation

\- Initial automated tests

\- Project development documentation


\## Phase 2 — Authentication


Status: [✓] COMPLETED


### Authentication Features


- [x] User Registration
- [x] bcrypt Password Hashing
- [x] Login
- [x] JWT Generation
- [x] JWT Authentication Middleware
- [x] Protected Profile Route
- [x] Profile Update
- [x] Password Change
- [x] Password Reset
- [x] Email OTP
- [x] Hashed OTP Storage
- [x] OTP Expiry
- [x] Reset Authorization Token
- [x] Rate Limiting


### Security and Validation Improvements


- [x] Strong JWT secret startup validation
- [x] Rejection of weak/placeholder JWT secrets
- [x] JWT restricted to HS256
- [x] Login and registration rate limiting
- [x] Strong input validation using Zod
- [x] Email normalization
- [x] Password validation
- [x] confirmPassword validation for password change and reset
- [x] Strict six-digit numeric OTP validation
- [x] Reset-token length validation
- [x] Rejection of unexpected fields on sensitive authentication endpoints
- [x] Prevention of sensitive authentication details from being logged
- [x] Safe user response fields without password hashes


### Testing & Validation


The backend build, authentication/reset tests, and regression tests passed.


## Phase 3 — Role Based Access Control (RBAC)


Status: Implemented and validated

### Supported roles

- **Patient** — the safe default assigned during normal registration.
- **Caregiver** — a recognized role with no additional patient-data access until an explicit relationship model is implemented.
- **Doctor** — a recognized role with no additional patient-data access until an explicit relationship model is implemented.
- **Admin** — can manage user roles through the protected administration endpoint.

### Authorization approach

- The database constrains roles to `patient`, `caregiver`, `doctor`, and `admin`; existing accounts without a valid role are safely migrated to `patient`.
- Login signs the authenticated user's database role into the JWT claim set.
- Authentication validates the signed token payload, including that its role is one of the supported roles.
- Centralized `requireRole(...)` middleware supports one or more allowed roles and returns `403` for authenticated users without permission.
- Normal registration does not accept role assignment and always creates a `patient` account, preventing self-assignment of privileged roles.

### Role management and protected functionality

- `PUT /api/auth/admin/users/:id/role` is protected by JWT authentication and `requireRole("admin")`.
- The endpoint accepts only a supported role and returns safe user fields; password hashes are not returned.
- Document upload, document listing, structured extraction, and reviewed-care-plan confirmation remain authenticated and owner-scoped for every role. Database queries require the document owner ID, preventing cross-user document access.

### Permission behaviour

Patients can access only their own protected account, document, and analysis resources. Caregiver and doctor roles currently retain the same owner-only resource boundary; the application does not infer care relationships or grant broad access to other users' medical documents. Admins can perform role management, but no unrestricted medical-document access is implemented.

### RBAC validation

The RBAC regression suite covers safe patient registration, role claims in JWTs, invalid and missing JWT rejection, supported-role validation, role middleware allow/deny behaviour, strict role-update validation, and safe admin-role update responses. TypeScript validation and the existing backend test suites passed during the Phase 3 implementation.

### Known limitations and future improvements

Caregiver and doctor access to patient data requires a separate, explicit, owner-approved relationship model with auditable grants and revocation. That model is intentionally not implemented by current RBAC, so no caregiver, doctor, or admin role receives implicit access to another user's medical documents or care plans.


\## Project Structure



```text

CareBridge/

├── backend/

├── frontend/

├── docs/

├── docker-compose.yml

└── .env.example



Technology Stack

TypeScript

Node.js

PostgreSQL

Docker

REST API

Git \& GitHub

Development Status



Phase 1 — Completed



Further phases will build on this foundation with additional healthcare, document-processing, and AI capabilities.



Repository

GitHub: https://github.com/krroushan11/CareBridge

