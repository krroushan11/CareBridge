import { Request, Response } from "express";
import { z } from "zod";
import { AuthRequest } from "../middlewares/authMiddleware";
import {
  answerChat,
  createChatTurn,
  listChatHistory,
  resolveChatAccess,
} from "../services/chatService";

const chatSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  patient_id: z.string().uuid().optional(),
}).strict();

const user = (req: Request) => (req as AuthRequest).user;

export const postChat = async (req: Request, res: Response) => {
  const authenticated = user(req);
  if (!authenticated) return res.status(401).json({ success: false, message: "Authentication required" });
  const parsed = chatSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: "A valid message is required" });
  try {
    const access = await resolveChatAccess(authenticated.id, authenticated.role, parsed.data.patient_id);
    if (!access) return res.status(403).json({ success: false, message: "Chat access is not authorized" });
    const result = await createChatTurn(access, authenticated.id, parsed.data.message);
    return res.status(201).json({ success: true, ...result });
  } catch (error) {
    console.error("Chat request failed", error instanceof Error ? error.message : "unknown error");
    return res.status(503).json({ success: false, message: "Chat is temporarily unavailable" });
  }
};

export const getChatHistory = async (req: Request, res: Response) => {
  const authenticated = user(req);
  if (!authenticated) return res.status(401).json({ success: false, message: "Authentication required" });
  try {
    const patientId = typeof req.query.patient_id === "string" ? req.query.patient_id : undefined;
    const access = await resolveChatAccess(authenticated.id, authenticated.role, patientId);
    if (!access) return res.status(403).json({ success: false, message: "Chat access is not authorized" });
    const conversationId = typeof req.query.conversation_id === "string" ? req.query.conversation_id : undefined;
    return res.json({ success: true, conversations: await listChatHistory(access, conversationId) });
  } catch (error) {
    console.error("Chat history request failed", error instanceof Error ? error.message : "unknown error");
    return res.status(503).json({ success: false, message: "Chat history is temporarily unavailable" });
  }
};
