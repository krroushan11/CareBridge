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


Status: [✓] COMPLETED


### RBAC Features


- [x] Allowed roles: patient, caregiver, doctor, and admin
- [x] Safe patient default for new and legacy accounts
- [x] Role included in signed JWTs and validated by authentication middleware
- [x] Centralized role authorization middleware
- [x] Admin-only role management endpoint
- [x] Owner-scoped medical-document and analysis access for all roles
- [x] RBAC regression tests


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

