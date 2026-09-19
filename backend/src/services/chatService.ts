import { Pool, PoolClient } from "pg";
import { pool } from "../config/database";
import { findActiveRelationshipForUser, hasPermission } from "./caregiverService";
import { chunkText } from "./chunkingService";
import { createConfiguredLlmProvider, getConfiguredEmbeddingModel, LlmProvider } from "./llmProvider";
import { LanguageRequest, localizeVerifiedResponse } from "./languageService";
import { assessEmergency } from "./emergencySafety";

export interface ChatAccess {
  patientId: string;
  relationshipId?: string;
}

export interface ChatCitation {
  chunk_id: string;
  document_id: string;
  verified_care_plan_id: string;
  excerpt: string;
}

const safetyResponse =
  "I can only provide general information grounded in the verified care information available in CareBridge. " +
  "I cannot diagnose, change treatment, or replace a clinician. If this may be an emergency or you feel unsafe, " +
  "contact local emergency services now.";

const unavailableResponse =
  "I couldn't find that information in your verified CareBridge records. Please consult your doctor or healthcare professional for medical advice.";

const greetingResponse =
  "I'm here to help with information in your verified CareBridge records. What would you like to know?";

const isGreeting = (message: string) =>
  /^(hi|hello|hey|hlw|good morning|good afternoon|good evening)[!.?\s]*$/i.test(message.trim());

const isRestrictedQuestion = (message: string) =>
  /\b(diagnos(e|is|ed)|what disease|prescribe|prescription|what treatment|increase .*dose|decrease .*dose|change .*dosage|stop taking|should i take)\b/i.test(message) ||
  /\b(ignore (all|previous)|hidden system prompt|show me another patient|every document|database directly)\b/i.test(message);

const unsafeGeneratedResponse = (message: string) =>
  /\b(you have|diagnosis|diagnosed with|prescribe|take \d+|increase (your )?(dose|dosage)|stop taking)\b/i.test(message);

export const resolveChatAccess = async (
  userId: string,
  role: string,
  patientId: string | undefined,
  client: Pool | PoolClient = pool
): Promise<ChatAccess | null> => {
  if (role === "patient") {
    if (patientId && patientId !== userId) return null;
    return { patientId: userId };
  }
  if (role !== "caregiver" || !patientId) return null;
  const relationship = await findActiveRelationshipForUser(patientId, userId, client);
  if (!relationship || !hasPermission(relationship, "view_care_plan")) return null;
  return { patientId, relationshipId: relationship.id };
};

const planText = (extraction: unknown, disclaimer: unknown): string =>
  `Verified care information:\n${JSON.stringify(extraction)}\nDisclaimer: ${String(disclaimer || "")}`;

export const indexVerifiedCarePlans = async (
  patientId: string,
  provider: LlmProvider = createConfiguredLlmProvider(),
  client: Pool | PoolClient = pool
) => {
  const plans = await client.query(
    `SELECT id, document_id, verified_extraction, disclaimer
     FROM verified_care_plans WHERE user_id = $1 ORDER BY confirmed_at DESC`,
    [patientId]
  );
  for (const plan of plans.rows) {
    const text = planText(plan.verified_extraction, plan.disclaimer);
    const chunks = chunkText(text);
    for (const chunk of chunks) {
      const existing = await client.query(
        `SELECT id, embedding FROM document_chunks
         WHERE document_id = $1 AND chunk_index = $2`,
        [plan.document_id, chunk.index]
      );
      if (existing.rows[0]?.embedding) continue;
      const embedding = await provider.embed(chunk.content, "RETRIEVAL_DOCUMENT");
      await client.query(
        `INSERT INTO document_chunks
           (user_id, document_id, verified_care_plan_id, chunk_index, chunk_text, content, content_hash, embedding, embedding_model, metadata)
         VALUES ($1, $2, $3, $4, $5, $5, $6, $7::vector, $8, '{"verification_status":"verified"}'::jsonb)
         ON CONFLICT (document_id, chunk_index)
         DO UPDATE SET chunk_text = EXCLUDED.chunk_text, content = EXCLUDED.content,
                       content_hash = EXCLUDED.content_hash,
                       user_id = EXCLUDED.user_id, verified_care_plan_id = EXCLUDED.verified_care_plan_id,
                       embedding = EXCLUDED.embedding, embedding_model = EXCLUDED.embedding_model,
                       metadata = EXCLUDED.metadata`,
        [patientId, plan.document_id, plan.id, chunk.index, chunk.content, chunk.contentHash, `[${embedding.join(",")}]`, getConfiguredEmbeddingModel()]
      );
    }
  }
};

export const retrieveVerifiedContext = async (
  patientId: string,
  question: string,
  provider: LlmProvider = createConfiguredLlmProvider(),
  client: Pool | PoolClient = pool
): Promise<ChatCitation[]> => {
  const embedding = await provider.embed(question, "RETRIEVAL_QUERY");
  const result = await client.query(
    `SELECT id AS chunk_id, document_id, verified_care_plan_id, content
     FROM document_chunks
     WHERE user_id = $1 AND embedding IS NOT NULL
     ORDER BY embedding <=> $2::vector
     LIMIT 5`,
    [patientId, `[${embedding.join(",")}]`]
  );
  return result.rows.map((row) => ({
    chunk_id: row.chunk_id,
    document_id: row.document_id,
    verified_care_plan_id: row.verified_care_plan_id,
    excerpt: String(row.content).slice(0, 2000),
  }));
};

const isUrgent = (message: string) => assessEmergency(message).severity !== "NONE";

const chatSystemPrompt = [
  "You are CareBridge's safety-restricted health information assistant.",
  "Answer only from the VERIFIED CONTEXT supplied by the application.",
  "If the answer is not in the context, say that it is not available in the verified information and suggest contacting a clinician.",
  "Do not diagnose, prescribe, recommend changing medication, or invent facts.",
  "Keep uncertainty and source limitations explicit. Never claim to be a clinician.",
].join(" ");

export const answerChat = async (
  question: string,
  context: ChatCitation[],
  provider: LlmProvider = createConfiguredLlmProvider()
): Promise<string> => {
  if (isUrgent(question)) return safetyResponse;
  if (isGreeting(question)) return greetingResponse;
  if (isRestrictedQuestion(question) || context.length === 0) return unavailableResponse;
  const answer = await provider.chat(
    chatSystemPrompt,
    `VERIFIED CONTEXT:\n${context.map((item) => `[${item.chunk_id}] ${item.excerpt}`).join("\n")}\n\nUSER QUESTION:\n${question}`
  );
  return unsafeGeneratedResponse(answer) ? unavailableResponse : answer;
};

export const createChatTurn = async (
  access: ChatAccess,
  userId: string,
  question: string,
  provider: LlmProvider = createConfiguredLlmProvider(),
  client: Pool | PoolClient = pool,
  languageRequest: LanguageRequest = {}
) => {
  const emergency = assessEmergency(question);
  if (emergency.severity !== "NONE") {
    const conversation = await client.query(
      `INSERT INTO chat_conversations (patient_id, created_by)
       VALUES ($1, $2) RETURNING id, created_at, updated_at`,
      [access.patientId, userId]
    );
    const conversationId = conversation.rows[0].id as string;
    await client.query(
      `INSERT INTO chat_messages (conversation_id, role, content, citations, safety_restricted)
       VALUES ($1, 'user', $2, '[]'::jsonb, TRUE), ($1, 'assistant', $3, '[]'::jsonb, TRUE)`,
      [conversationId, question, emergency.response]
    );
    return {
      conversation: conversation.rows[0],
      answer: emergency.response,
      citations: [],
      safety_restricted: true,
      emergency: { severity: emergency.severity, category: emergency.category },
      language: "en",
      mode: "standard",
      grounded: false,
      translated: false,
      safety_checked: true,
    };
  }
  await indexVerifiedCarePlans(access.patientId, provider, client);
  const context = await retrieveVerifiedContext(access.patientId, question, provider, client);
  const restricted = isUrgent(question) || isRestrictedQuestion(question);
  const groundedAnswer = await answerChat(question, context, provider);
  const localized = await localizeVerifiedResponse(groundedAnswer, languageRequest, provider);
  const answer = localized.answer;
  const conversation = await client.query(
    `INSERT INTO chat_conversations (patient_id, created_by)
     VALUES ($1, $2) RETURNING id, created_at, updated_at`,
    [access.patientId, userId]
  );
  const conversationId = conversation.rows[0].id as string;
  await client.query(
    `INSERT INTO chat_messages (conversation_id, role, content, citations, safety_restricted)
     VALUES ($1, 'user', $2, '[]'::jsonb, $3), ($1, 'assistant', $4, $5::jsonb, $3)`,
    [conversationId, question, restricted, answer, JSON.stringify(context)]
  );
  return {
    conversation: conversation.rows[0], answer, citations: context, safety_restricted: restricted,
    language: localized.metadata.language, mode: localized.metadata.mode,
    grounded: context.length > 0, translated: localized.metadata.translated,
    safety_checked: localized.metadata.safety_checked,
    emergency: { severity: "NONE" },
  };
};

export const listChatHistory = async (
  access: ChatAccess,
  conversationId: string | undefined,
  client: Pool | PoolClient = pool
) => {
  const result = await client.query(
    `SELECT c.id, c.created_at, c.updated_at,
            COALESCE(json_agg(json_build_object(
              'id', m.id, 'role', m.role, 'content', m.content,
              'citations', m.citations, 'safety_restricted', m.safety_restricted,
              'created_at', m.created_at
            ) ORDER BY m.created_at) FILTER (WHERE m.id IS NOT NULL), '[]') AS messages
     FROM chat_conversations c
     LEFT JOIN chat_messages m ON m.conversation_id = c.id
     WHERE c.patient_id = $1 AND ($2::uuid IS NULL OR c.id = $2::uuid)
     GROUP BY c.id ORDER BY c.updated_at DESC LIMIT 50`,
    [access.patientId, conversationId || null]
  );
  return result.rows;
};
