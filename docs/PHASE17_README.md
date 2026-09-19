# Phase 17 — Emergency Safety Layer

Phase 17 adds deterministic emergency detection before normal RAG retrieval,
LLM generation, or Phase 16 language transformation.

## Safety rules

The centralized rules classify messages as `NONE`, `URGENT`, or `EMERGENCY`.
The current supported emergency categories are:

- Severe breathing difficulty
- Concerning chest symptoms
- Stroke warning signs
- Uncontrolled or severe bleeding
- Seizure or unresponsiveness
- Severe allergic reaction or anaphylaxis
- Self-harm emergency
- Suspected overdose or poisoning

The rules are predefined in `backend/src/services/emergencySafety.ts`. The
LLM never decides whether a message is an emergency.

## Emergency flow

For an `EMERGENCY` match, the backend:

1. Authorizes the request using the existing patient or caregiver access rules.
2. Classifies the message locally.
3. Does not index care plans.
4. Does not generate embeddings.
5. Does not retrieve patient records.
6. Does not call the chat model.
7. Does not call the Phase 16 language model.
8. Returns concise English emergency instructions.
9. Persists the user message and safety response with empty citations.

Emergency responses tell users to contact their local emergency service or go
to the nearest emergency department. No emergency phone numbers are
invented.

## Frontend

Emergency responses are rendered with an assertive accessible alert treatment.
The response is not translated or simplified, preserving approved safety
wording.

## Verification

Focused tests cover every supported emergency category, the `NONE` case, and
frontend assertive alert rendering.
