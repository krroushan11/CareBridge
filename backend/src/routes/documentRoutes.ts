import { Router } from "express";
import {
    extractStructuredDocument,
    listDocuments,
    uploadDocument,
} from "../controllers/documentController";
import { authenticateToken } from "../middlewares/authMiddleware";
import { uploadMedicalDocument } from "../middlewares/documentUploadMiddleware";

const router = Router();

router.post("/upload", authenticateToken, uploadMedicalDocument, uploadDocument);
router.get("/", authenticateToken, listDocuments);
router.get("/:id/extract", authenticateToken, extractStructuredDocument);

export default router;
