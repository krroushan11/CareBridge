import { Router } from "express";
import {
    extractStructuredDocument,
    downloadDocument,
    deleteDocument,
    getDocumentProcessingStatus,
    listDocuments,
    updateDocumentMetadata,
    uploadDocument,
} from "../controllers/documentController";
import { authenticateToken } from "../middlewares/authMiddleware";
import { uploadMedicalDocument } from "../middlewares/documentUploadMiddleware";

const router = Router();

router.post("/upload", authenticateToken, uploadMedicalDocument, uploadDocument);
router.get("/", authenticateToken, listDocuments);
router.get("/:id/download", authenticateToken, downloadDocument);
router.get("/:id/status", authenticateToken, getDocumentProcessingStatus);
router.patch("/:id", authenticateToken, updateDocumentMetadata);
router.delete("/:id", authenticateToken, deleteDocument);
router.get("/:id/extract", authenticateToken, extractStructuredDocument);

export default router;
