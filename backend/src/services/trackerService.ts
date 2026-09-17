import { z } from "zod";
import { createHash } from "crypto";
import type { StructuredExtractionOutput } from "./aiExtractionService";

// ---------------------------------------------------------------------------
// Status lifecycles (Phase 11)
// ---------------------------------------------------------------------------

export const FOLLOW_UP_STATUSES = [
  "pending",
  "scheduled",
  "completed",
  "cancelled",
  "missed",
] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];

export const MEDICAL_TEST_STATUSES = [
  "pending",
  "scheduled",
  "completed",
  "cancelled",
] as const;
export type MedicalTestStatus = (typeof MEDICAL_TEST_STATUSES)[number];

export const TERMINAL_STATUSES = new Set(["completed", "cancelled"]);

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

export const calendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Dates must use YYYY-MM-DD").refine(
  (value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)),
  "Invalid date"
);

export const optionalTimeSchema = z.string().regex(TIME_PATTERN, "Time must use HH:MM or HH:MM:SS").nullable().optional();

const optionalText = z.string().trim().min(1).max(2000).nullable().optional();

// Status transitions: reopening a completed/cancelled task is allowed for the
// owner (correcting mistakes) but silently ignoring an identical status keeps
// repeated actions idempotent.
const followUpStatusSchema = z.enum(FOLLOW_UP_STATUSES);
const medicalTestStatusSchema = z.enum(MEDICAL_TEST_STATUSES);

export const createFollowUpSchema = z.object({
  title: z.string().trim().min(1).max(255),
  description: optionalText,
  provider_or_specialist: z.string().trim().min(1).max(255).nullable().optional(),
  appointment_date: calendarDateSchema.nullable().optional(),
  appointment_time: optionalTimeSchema,
  due_date: calendarDateSchema.nullable().optional(),
  status: followUpStatusSchema.optional(),
}).strict().refine(
  (value) => !value.appointment_date || !value.due_date || value.due_date >= value.appointment_date,
  "Due date must not be before the appointment date"
);

export const createMedicalTestSchema = z.object({
  test_name: z.string().trim().min(1).max(255),
  instructions: optionalText,
  scheduled_date: calendarDateSchema.nullable().optional(),
  result_summary: z.string().trim().min(1).max(500).nullable().optional(),
  status: medicalTestStatusSchema.optional(),
}).strict();

// Update schemas are declared independently because Zod v4 forbids .partial()
// on object schemas containing refinements.
export const updateFollowUpSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  description: optionalText,
  provider_or_specialist: z.string().trim().min(1).max(255).nullable().optional(),
  appointment_date: calendarDateSchema.nullable().optional(),
  appointment_time: optionalTimeSchema,
  due_date: calendarDateSchema.nullable().optional(),
  status: followUpStatusSchema.optional(),
}).strict().refine(
  (value) => !value.appointment_date || !value.due_date || value.due_date >= value.appointment_date,
  "Due date must not be before the appointment date"
);

export const updateMedicalTestSchema = z.object({
  test_name: z.string().trim().min(1).max(255).optional(),
  instructions: optionalText,
  scheduled_date: calendarDateSchema.nullable().optional(),
  result_summary: z.string().trim().min(1).max(500).nullable().optional(),
  status: medicalTestStatusSchema.optional(),
}).strict();

// ---------------------------------------------------------------------------
// Date normalization
// ---------------------------------------------------------------------------

export type NormalizedDate =
  | { ok: true; value: string | null }
  | { ok: false; error: string };

/**
 * Validates a date value coming from user input or AI output.
 * Accepts ISO dates (YYYY-MM-DD) and ISO date-times. Never invents a date:
 * null/undefined/empty input maps to null so missing information stays missing.
 */
export const normalizeCalendarDate = (value: unknown): NormalizedDate => {
  if (value === null || value === undefined || value === "") {
    return { ok: true, value: null };
  }

  if (typeof value !== "string") {
    return { ok: false, error: "Invalid date" };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: true, value: null };
  }

  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnlyMatch) {
    const isoCandidate = `${trimmed}T00:00:00Z`;
    if (Number.isNaN(Date.parse(isoCandidate)) || new Date(isoCandidate).toISOString().slice(0, 10) !== trimmed) {
      return { ok: false, error: "Invalid date" };
    }
    return { ok: true, value: trimmed };
  }

  const dateTimeMatch = /^(\d{4}-\d{2}-\d{2})[T\s]\d{2}:\d{2}/.exec(trimmed);
  if (dateTimeMatch) {
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
      return { ok: false, error: "Invalid date" };
    }
    // Normalize the date part; time precision below a date is not stored here.
    return { ok: true, value: parsed.toISOString().slice(0, 10) };
  }

  return { ok: false, error: "Invalid date" };
};

/**
 * Resolves a date from relative timeframes such as "in 2 weeks" against a
 * reference date. Only explicit supported patterns are resolved; anything
 * ambiguous returns null so no date is invented.
 */
export const resolveRelativeTimeframe = (value: unknown, now = new Date()): NormalizedDate => {
  if (typeof value !== "string") {
    return normalizeCalendarDate(value);
  }

  const trimmed = value.trim().toLowerCase();
  const relativeMatch = /^(?:in\s+)?(\d+)\s+(day|days|week|weeks|month|months)$/.exec(trimmed);
  if (relativeMatch) {
    const amount = Number(relativeMatch[1]);
    const unit = relativeMatch[2];
    const resolved = new Date(now.getTime());
    if (unit.startsWith("day")) {
      resolved.setUTCDate(resolved.getUTCDate() + amount);
    } else if (unit.startsWith("week")) {
      resolved.setUTCDate(resolved.getUTCDate() + amount * 7);
    } else {
      resolved.setUTCMonth(resolved.getUTCMonth() + amount);
    }
    return { ok: true, value: resolved.toISOString().slice(0, 10) };
  }

  if (trimmed === "today") {
    return { ok: true, value: now.toISOString().slice(0, 10) };
  }

  if (trimmed === "tomorrow") {
    const resolved = new Date(now.getTime());
    resolved.setUTCDate(resolved.getUTCDate() + 1);
    return { ok: true, value: resolved.toISOString().slice(0, 10) };
  }

  return { ok: false, error: "Invalid date" };
};

/**
 * AI dates are trusted only when they parse as calendar dates or explicit
 * relative timeframes. Unsupported text ("next month", "after surgery")
 * yields null so a follow-up is stored without an invented date.
 */
export const normalizeAiDate = (value: unknown, now = new Date()): NormalizedDate => {
  if (value === null || value === undefined || value === "") {
    return { ok: true, value: null };
  }

  if (typeof value !== "string") {
    return normalizeCalendarDate(value);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: true, value: null };
  }

  if (/^(?:next week|next month)$/i.test(trimmed)) {
    const resolved = new Date(now.getTime());
    if (/next week/i.test(trimmed)) {
      resolved.setUTCDate(resolved.getUTCDate() + 7);
    } else {
      resolved.setUTCMonth(resolved.getUTCMonth() + 1);
    }
    return { ok: true, value: resolved.toISOString().slice(0, 10) };
  }

  const direct = normalizeCalendarDate(trimmed);
  if (direct.ok && direct.value !== null) return direct;

  const relative = resolveRelativeTimeframe(trimmed, now);
  if (relative.ok && relative.value !== null) return relative;

  // Free-form AI text such as "after surgery" is not a validation failure: it
  // maps to a missing date so records are stored without an invented date.
  return { ok: true, value: null };
};

// ---------------------------------------------------------------------------
// Duplicate-protection fingerprints
// ---------------------------------------------------------------------------

const canonicalize = (value: string | null | undefined) =>
  (value || "").toLowerCase().replace(/\s+/g, " ").trim();

export const followUpFingerprint = (title: string, sourceText?: string | null): string =>
  createHash("sha256")
    .update(`follow-up|${canonicalize(sourceText || title).slice(0, 300)}`)
    .digest("hex");

export const medicalTestFingerprint = (testName: string, sourceText?: string | null): string =>
  createHash("sha256")
    .update(`medical-test|${canonicalize(sourceText || testName).slice(0, 300)}`)
    .digest("hex");

// ---------------------------------------------------------------------------
// Reminder logic (pure helpers, mirrors frontend/src/reminderUtils.js style)
// ---------------------------------------------------------------------------

export type ReminderRecord = {
  id: string;
  title: string;
  kind: "follow_up" | "medical_test";
  date: string | null;
  status: string;
};

export const isUpcomingWithinDays = (date: string | Date | null | undefined, days: number, now = new Date()) => {
  if (!date) return false;
  const target = typeof date === "string" ? new Date(`${date.slice(0, 10)}T00:00:00Z`) : date;
  if (Number.isNaN(target.getTime())) return false;

  const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const horizon = startOfToday + days * 24 * 60 * 60 * 1000;
  return target.getTime() >= startOfToday && target.getTime() < horizon;
};

export const isOverdue = (record: ReminderRecord, now = new Date()) => {
  if (!record.date || TERMINAL_STATUSES.has(record.status)) return false;
  const target = new Date(`${record.date.slice(0, 10)}T23:59:59.999Z`);
  return !Number.isNaN(target.getTime()) && target.getTime() < now.getTime();
};

/**
 * Reminder-ready records exclude terminal states (completed/cancelled/missed
 * for tests; completed/cancelled for follow-ups are filtered by SQL queries,
 * this helper is the shared client-side guard).
 */
export const isReminderEligible = (record: ReminderRecord) =>
  !TERMINAL_STATUSES.has(record.status) && record.status !== "missed";

// ---------------------------------------------------------------------------
// AI extraction mapping (Phase 11)
// ---------------------------------------------------------------------------

export type MappedFollowUpRecord = {
  title: string;
  description: string | null;
  provider_or_specialist: string | null;
  appointment_date: string | null;
  status: FollowUpStatus;
  source_text: string | null;
  record_fingerprint: string;
};

export type MappedMedicalTestRecord = {
  test_name: string;
  instructions: string | null;
  scheduled_date: string | null;
  result_summary: string | null;
  status: MedicalTestStatus;
  source_text: string | null;
  record_fingerprint: string;
};

const safeString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toRecord = (item: unknown): Record<string, unknown> | null =>
  item && typeof item === "object" ? item as Record<string, unknown> : null;

/**
 * Maps structured AI follow-up extraction output to database-shaped records.
 * Dates are only set when they can be safely determined; relative timeframes
 * are resolved against the extraction time; anything ambiguous stays null.
 */
export const mapExtractionFollowUps = (
  extraction: Pick<StructuredExtractionOutput, "follow_up">,
  now = new Date()
): MappedFollowUpRecord[] => {
  const items = Array.isArray(extraction.follow_up) ? extraction.follow_up : [];
  const mapped: MappedFollowUpRecord[] = [];

  for (const item of items) {
    if (typeof item === "string") {
      const title = safeString(item);
      if (!title) continue;
      mapped.push({
        title,
        description: null,
        provider_or_specialist: null,
        appointment_date: null,
        status: "pending",
        source_text: title,
        record_fingerprint: followUpFingerprint(title),
      });
      continue;
    }

    const record = toRecord(item);
    if (!record) continue;

    const title = safeString(record.type_or_reason);
    if (!title) continue;

    const rawDate = record.recommended_date_or_timeframe;
    const resolvedDate = normalizeAiDate(rawDate, now);
    const date = resolvedDate.ok ? resolvedDate.value : null;
    const instructions = safeString(record.instructions);
    const provider = safeString(record.provider_or_specialist);
    const sourceText = safeString(record.source_text);

    mapped.push({
      title,
      description: instructions,
      provider_or_specialist: provider,
      appointment_date: date,
      status: "pending",
      source_text: sourceText || title,
      record_fingerprint: followUpFingerprint(title, sourceText),
    });
  }

  return mapped;
};

/**
 * Maps structured AI test extraction output to database-shaped records.
 * Extracted result values are preserved verbatim in result_summary; the
 * service never invents medical results.
 */
export const mapExtractionTests = (
  extraction: Pick<StructuredExtractionOutput, "tests">,
  now = new Date()
): MappedMedicalTestRecord[] => {
  const items = Array.isArray(extraction.tests) ? extraction.tests : [];
  const mapped: MappedMedicalTestRecord[] = [];

  for (const item of items) {
    if (typeof item === "string") {
      const testName = safeString(item);
      if (!testName) continue;
      mapped.push({
        test_name: testName,
        instructions: null,
        scheduled_date: null,
        result_summary: null,
        status: "pending",
        source_text: testName,
        record_fingerprint: medicalTestFingerprint(testName),
      });
      continue;
    }

    const record = toRecord(item);
    if (!record) continue;

    const testName = safeString(record.name);
    if (!testName) continue;

    const resultSummary = safeString(record.result_or_value);
    const status: MedicalTestStatus = resultSummary ? "completed" : "pending";
    const sourceText = safeString(record.source_text);

    mapped.push({
      test_name: testName,
      instructions: sourceText,
      scheduled_date: null,
      result_summary: resultSummary,
      status,
      source_text: sourceText || testName,
      record_fingerprint: medicalTestFingerprint(testName, sourceText),
    });
  }

  return mapped;
};
