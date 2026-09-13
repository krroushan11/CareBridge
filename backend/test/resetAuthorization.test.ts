import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test, { after } from "node:test";
import bcrypt from "bcryptjs";
import { pool } from "../src/config/database";
import {
  resetPassword,
  verifyResetOTP,
} from "../src/controllers/authController";

const originalQuery = pool.query.bind(pool);

const createResponse = () => {
  const response: any = {
    statusCode: 200,
    body: undefined,
    status(statusCode: number) {
      this.statusCode = statusCode;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };

  return response;
};

const setQueryMock = (
  handler: (query: string, values: unknown[]) => Promise<{ rows: unknown[] }>
) => {
  (pool as any).query = (query: string, values: unknown[]) =>
    handler(query, values);
};

after(async () => {
  (pool as any).query = originalQuery;
  await pool.end();
});

test("issues a hashed reset authorization token after valid OTP verification", async () => {
  const otp = "123456";
  const otpHash = await bcrypt.hash(otp, 10);
  let storedTokenHash = "";
  let authorizationExpiry: Date | undefined;

  setQueryMock(async (query, values) => {
    if (query.startsWith("SELECT * FROM users")) {
      return {
        rows: [{
          id: "user-id",
          reset_otp: otpHash,
          reset_otp_expiry: new Date(Date.now() + 60_000),
          reset_otp_verified: false,
        }],
      };
    }

    assert.match(query, /reset_authorization_token_hash = \$3/);
    assert.match(query, /reset_authorization_expiry = \$4/);
    storedTokenHash = values[2] as string;
    authorizationExpiry = values[3] as Date;
    return { rows: [{ id: "user-id" }] };
  });

  const res = createResponse();
  await verifyResetOTP({ body: { email: "user@example.com", otp } } as any, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(typeof res.body.resetToken, "string");
  assert.equal(res.body.resetToken.length, 64);
  assert.notEqual(storedTokenHash, res.body.resetToken);
  assert.equal(
    storedTokenHash,
    createHash("sha256").update(res.body.resetToken).digest("hex")
  );
  assert.ok(authorizationExpiry);
  assert.ok(authorizationExpiry.getTime() > Date.now());
  assert.ok(authorizationExpiry.getTime() <= Date.now() + 5 * 60 * 1000 + 2_000);
});

test("rejects a reset request without a reset authorization token", async () => {
  setQueryMock(async () => {
    throw new Error("Database must not be queried without a reset token");
  });

  const res = createResponse();
  await resetPassword(
    { body: { email: "user@example.com", newPassword: "new-password" } } as any,
    res
  );

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.success, false);
});

test("rejects an invalid reset authorization token", async () => {
  let capturedQuery = "";

  setQueryMock(async (query) => {
    capturedQuery = query;
    return { rows: [] };
  });

  const invalidRes = createResponse();
  await resetPassword(
    {
      body: {
        email: "user@example.com",
        newPassword: "new-password",
        confirmPassword: "new-password",
        resetToken: "invalid-token",
      },
    } as any,
    invalidRes
  );

  assert.equal(invalidRes.statusCode, 403);
  assert.match(capturedQuery, /reset_authorization_token_hash = \$3/);
});

test("rejects an expired reset authorization token", async () => {
  let capturedQuery = "";

  setQueryMock(async (query) => {
    capturedQuery = query;
    return { rows: [] };
  });

  const expiredRes = createResponse();
  await resetPassword(
    {
      body: {
        email: "user@example.com",
        newPassword: "new-password",
        confirmPassword: "new-password",
        resetToken: "expired-token",
      },
    } as any,
    expiredRes
  );

  assert.equal(expiredRes.statusCode, 403);
  assert.match(capturedQuery, /reset_authorization_expiry >= NOW\(\)/);
});

test("consumes a reset authorization token so replay fails", async () => {
  let consumed = false;

  setQueryMock(async () => {
    if (consumed) {
      return { rows: [] };
    }

    consumed = true;
    return { rows: [{ id: "user-id" }] };
  });

  const firstRes = createResponse();
  const secondRes = createResponse();
  const body = {
    email: "user@example.com",
    newPassword: "new-password",
    confirmPassword: "new-password",
    resetToken: "valid-token",
  };

  await resetPassword({ body } as any, firstRes);
  await resetPassword({ body } as any, secondRes);

  assert.equal(firstRes.statusCode, 200);
  assert.equal(secondRes.statusCode, 403);
});

test("allows only one concurrent reset authorization consumption", async () => {
  let consumed = false;

  setQueryMock(async () => {
    await new Promise((resolve) => setImmediate(resolve));

    if (consumed) {
      return { rows: [] };
    }

    consumed = true;
    return { rows: [{ id: "user-id" }] };
  });

  const firstRes = createResponse();
  const secondRes = createResponse();
  const body = {
    email: "user@example.com",
    newPassword: "new-password",
    confirmPassword: "new-password",
    resetToken: "valid-token",
  };

  await Promise.all([
    resetPassword({ body } as any, firstRes),
    resetPassword({ body } as any, secondRes),
  ]);

  assert.deepEqual(
    [firstRes.statusCode, secondRes.statusCode].sort(),
    [200, 403]
  );
});

test("a new OTP clears prior reset authorization fields", () => {
  const controllerSource = readFileSync(
    new URL("../src/controllers/authController.ts", import.meta.url),
    "utf8"
  );

  assert.match(
    controllerSource,
    /reset_authorization_token_hash = NULL,[\s\S]*reset_authorization_expiry = NULL/
  );
});
