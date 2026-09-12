import { mkdirSync } from "fs";
import { basename, extname, resolve } from "path";
import { randomUUID } from "crypto";
import multer, { FileFilterCallback } from "multer";
import { NextFunction, Request, Response } from "express";

export const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024;

const documentExtensions: Record<string, string[]> = {
  "application/pdf": [".pdf"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
};

const documentStorageDirectory = resolve(
  process.cwd(),
  "private_uploads",
  "documents"
);

mkdirSync(documentStorageDirectory, { recursive: true });

export const isAllowedMedicalDocument = (
  mimeType: string,
  originalName: string
) => {
  const extension = extname(originalName).toLowerCase();
  return documentExtensions[mimeType]?.includes(extension) ?? false;
};

export const getPrivateDocumentPath = (storageKey: string) =>
  resolve(documentStorageDirectory, basename(storageKey));

const storage = multer.diskStorage({
  destination: documentStorageDirectory,
  filename: (_req, file, callback) => {
    callback(null, `${randomUUID()}${extname(file.originalname).toLowerCase()}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_DOCUMENT_SIZE_BYTES,
    files: 1,
  },
  fileFilter: (_req, file, callback: FileFilterCallback) => {
    if (!isAllowedMedicalDocument(file.mimetype, file.originalname)) {
      return callback(new Error("Only PDF, JPEG, and PNG medical documents are allowed"));
    }

    callback(null, true);
  },
});

export const uploadMedicalDocument = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  upload.single("document")(req, res, (error: unknown) => {
    if (!error) {
      return next();
    }

    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        success: false,
        message: "Medical document must be 10 MB or smaller",
      });
    }

    return res.status(400).json({
      success: false,
      message: "Only PDF, JPEG, and PNG medical documents are allowed",
    });
  });
};
