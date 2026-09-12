# CareBridge AI — Product Requirements

## 1. Overview
CareBridge is an AI-assisted care navigation and support platform designed to help people understand health information, identify appropriate next steps, and connect with relevant care resources without replacing qualified medical professionals.

## 2. Problem
People can struggle to understand medical terminology and care instructions, identify appropriate care resources, recognise situations that may need urgent attention, and keep track of health information and follow-up actions.

## 3. Product Goal
Provide a single experience where users can securely manage relevant health information and receive understandable, structured assistance.

## 4. Core Areas

### Authentication
Secure account access, protected APIs, and password-reset support.

### Medical Documents
Securely upload and manage medical documents. Current backend supports authenticated upload, PDF/JPEG/PNG validation, size limits, private storage, owner-scoped listing, and metadata.

### Document Intelligence
Progressively transform:
`Document → Text/OCR → Normalized Text → Structured Information`

### AI Assistance
Use AI to extract and explain relevant information from user-provided health documents in a structured and understandable way. AI is not an independent diagnosis system and does not replace qualified medical professionals.

### Tracking
Help users follow document-derived information over time, such as medicines, tests, findings, instructions, and follow-up information when actually present in the source.

## 5. Security & Privacy
- Protected document operations require authentication.
- Enforce owner-scoped access.
- Keep uploaded documents private.
- Do not unnecessarily expose paths/storage keys.
- Never log passwords, OTPs, reset tokens, JWTs, credentials, or sensitive document contents.
- Validate file type and size.
- Clean up failed uploads when needed.

## 6. Reliability
Document processing should have explicit states such as:
`uploaded → processing → completed/failed`

## 7. Safety Boundary
CareBridge should organise and explain information and surface information from user-provided documents. It should not claim to replace a doctor, independently diagnose, invent unsupported facts, or hide uncertainty.

## 8. Definition of Done
A milestone is complete only when its requirement is documented, implementation is complete, checks pass, relevant failure cases are tested, changed files/results are recorded, and unrelated code/data/schema is untouched.
