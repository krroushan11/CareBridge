# Phase 16 — Multilingual simplification

## Status

Complete. Phase 16 adds a post-grounding language layer to the Verified Care Assistant without changing Phase 15 retrieval, authorization, citations, history, or safety gates.

## Supported languages

English (`en`), Simple English (`en-simple`), Hindi (`hi`), Bengali (`bn`), Marathi (`mr`), Tamil (`ta`), Telugu (`te`), Kannada (`kn`), Gujarati (`gu`), Punjabi (`pa`), and Malayalam (`ml`). The shared backend and frontend language configurations contain the code, display name, locale, and enabled flag for each language.

## Architecture and safety

`question → existing authorization → verified-plan retrieval → grounded Phase 15 answer → Phase 16 language layer → safety validation → response`

The language layer uses the already configured LLM provider only; it does not add a translation provider or retrieve any records. It is given only the established grounded answer. Its prompt prohibits additions, diagnoses, prescriptions, changed instructions, and changed clinical values. The validator requires clinical literals (medicines, measurements, and dates) to survive and requires an explicit safety signal where the original contained one. A blank, failed, or invalid transformation returns the original grounded answer instead. Citations remain the original verified chunk citations.

This is a safeguard, not a guarantee of clinical-grade translation. A clinician/interpreter should be used for high-stakes decisions; users should rely on the original record for disputed wording.

## UI and session behavior

The Verified Care Assistant has an accessible native language select and a plain-language checkbox. Both work by keyboard and are session-persisted with `sessionStorage`; no page reload is required. English is the default. Simple English automatically enables simplification.

## API

`POST /api/chat` accepts optional fields while retaining Phase 15 compatibility:

```json
{ "message": "What does my report say?", "language": "hi", "simplify": true }
```

Omitted fields default to `language: "en"` and `simplify: false`. Responses retain `answer`, `citations`, and `safety_restricted`, and add `language`, `mode`, `grounded`, `translated`, and `safety_checked`.

## Configuration and testing

No new environment variables or credentials are required. The existing `AI_API_KEY`/provider configuration is used only after Phase 15 grounding. Tests are in `backend/test/phase16Language.test.ts` and `frontend/test/chatUtils.test.js`; run with `npx tsx --test test/phase15Chat.test.ts test/phase16Language.test.ts` from `backend`, and `npm run test:chat` from `frontend`.
