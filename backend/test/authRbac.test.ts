import assert from "node:assert/strict";
import { after, test } from "node:test";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "../src/config/database";
import {
  login,
  register,
  updateUserRole,
} from "../src/controllers/authController";
import {
  authenticateToken,
  requireRole,
} from "../src/middlewares/authMiddleware";

const originalQuery = pool.query.bind(pool);
const originalJwtSecret = process.env.JWT_SECRET;

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
  if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalJwtSecret;
  await pool.end();
});

test("registration always creates a patient and excludes role mass assignment", async () => {
  let values: unknown[] = [];
  setQueryMock(async (query, queryValues) => {
    if (query.startsWith("SELECT * FROM users")) {
      return { rows: [] };
    }

    values = queryValues;
    assert.match(query, /VALUES \(\$1, \$2, \$3, 'patient'\)/);
    return {
      rows: [{
        id: "user-a",
        name: "Patient",
        email: "patient@example.com",
        role: "patient",
        created_at: new Date(),
      }],
    };
  });

  const res = createResponse();
  await register({
    body: {
      name: "Patient",
      email: "Patient@Example.com",
      password: "strong-password",
      role: "admin",
    },
  } as any, res);

  assert.equal(res.statusCode, 201);
  assert.equal(values[1], "patient@example.com");
  assert.equal(res.body.user.role, "patient");
  assert.equal(res.body.user.password, undefined);
});

test("invalid registration input is rejected", async () => {
  let queryCalled = false;
  setQueryMock(async () => {
    queryCalled = true;
    return { rows: [] };
  });

  const res = createResponse();
  await register({
    body: {
      name: "Patient",
      email: "not-an-email",
      password: "short",
    },
  } as any, res);

  assert.equal(res.statusCode, 400);
  assert.equal(queryCalled, false);
});

test("duplicate registration is rejected", async () => {
  setQueryMock(async (query) => {
    if (query.startsWith("SELECT * FROM users")) {
      return { rows: [{ id: "existing-user" }] };
    }

    throw new Error("Insert must not run for duplicate registration");
  });

  const res = createResponse();
  await register({
    body: {
      name: "Patient",
      email: "patient@example.com",
      password: "strong-password",
    },
  } as any, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, "User already exists");
});

test("login signs the trusted database role into the JWT", async () => {
  process.env.JWT_SECRET = "test-jwt-secret";
  const passwordHash = await bcrypt.hash("password", 10);
  setQueryMock(async () => ({
    rows: [{
      id: "user-a",
      email: "patient@example.com",
      password: passwordHash,
      role: "doctor",
    }],
  }));

  const res = createResponse();
  await login({
    body: { email: "patient@example.com", password: "password" },
  } as any, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.user.role, "doctor");
  assert.equal(res.body.user.password, undefined);
  assert.equal(jwt.verify(res.body.token, process.env.JWT_SECRET).role, "doctor");
});

test("invalid login password is rejected", async () => {
  process.env.JWT_SECRET = "test-jwt-secret";
  const passwordHash = await bcrypt.hash("correct-password", 10);
  setQueryMock(async () => ({
    rows: [{
      id: "user-a",
      email: "patient@example.com",
      password: passwordHash,
      role: "patient",
    }],
  }));

  const res = createResponse();
  await login({
    body: { email: "patient@example.com", password: "wrong-password" },
  } as any, res);

  assert.equal(res.statusCode, 401);
});

test("invalid JWT and missing JWT are rejected", () => {
  process.env.JWT_SECRET = "test-jwt-secret";

  const missingRes = createResponse();
  authenticateToken({ headers: {} } as any, missingRes, () => {
    throw new Error("next must not be called");
  });
  assert.equal(missingRes.statusCode, 401);

  const invalidRes = createResponse();
  authenticateToken({
    headers: { authorization: "Bearer invalid" },
  } as any, invalidRes, () => {
    throw new Error("next must not be called");
  });
  assert.equal(invalidRes.statusCode, 401);
});

test("role middleware allows only explicitly permitted roles", () => {
  const allowedRes = createResponse();
  let allowedNext = false;
  requireRole("patient")({
    user: { id: "user-a", email: "patient@example.com", role: "patient" },
  } as any, allowedRes, () => {
    allowedNext = true;
  });
  assert.equal(allowedNext, true);

  const deniedRes = createResponse();
  requireRole("admin")({
    user: { id: "user-a", email: "patient@example.com", role: "patient" },
  } as any, deniedRes, () => {
    throw new Error("next must not be called");
  });
  assert.equal(deniedRes.statusCode, 403);

  const multiRoleRes = createResponse();
  let multiRoleNext = false;
  requireRole("caregiver", "doctor")({
    user: { id: "user-a", email: "doctor@example.com", role: "doctor" },
  } as any, multiRoleRes, () => {
    multiRoleNext = true;
  });
  assert.equal(multiRoleNext, true);
});

test("admin role updates validate roles and return safe user data", async () => {
  let updateValues: unknown[] = [];
  setQueryMock(async (query, values) => {
    updateValues = values;
    assert.match(query, /SET role = \$1/);
    return {
      rows: [{
        id: "user-b",
        name: "Caregiver",
        email: "caregiver@example.com",
        role: "caregiver",
        created_at: new Date(),
      }],
    };
  });

  const res = createResponse();
  await updateUserRole({
    params: { id: "user-b" },
    body: { role: "caregiver" },
  } as any, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(updateValues, ["caregiver", "user-b"]);
  assert.equal(res.body.user.password, undefined);

  const unexpectedFieldRes = createResponse();
  await updateUserRole({
    params: { id: "user-b" },
    body: { role: "doctor", extra: true },
  } as any, unexpectedFieldRes);
  assert.equal(unexpectedFieldRes.statusCode, 400);

  const invalidRes = createResponse();
  await updateUserRole({
    params: { id: "user-b" },
    body: { role: "superuser" },
  } as any, invalidRes);
  assert.equal(invalidRes.statusCode, 400);
});

test("JWT role is refreshed from the current database user, not the request body", async () => {
  process.env.JWT_SECRET = "test-jwt-secret";
  const token = jwt.sign(
    { id: "user-a", email: "patient@example.com", role: "patient" },
    process.env.JWT_SECRET
  );
  setQueryMock(async () => ({
    rows: [{ id: "user-a", email: "patient@example.com", role: "patient" }],
  }));
  const req: any = {
    headers: { authorization: `Bearer ${token}` },
    body: { role: "admin" },
  };
  const res = createResponse();
  await authenticateToken(req, res, () => undefined);

  assert.equal(req.user.role, "patient");
});

test("an old elevated JWT loses access after the database role changes", async () => {
  process.env.JWT_SECRET = "test-jwt-secret";
  const token = jwt.sign(
    { id: "user-a", email: "patient@example.com", role: "admin" },
    process.env.JWT_SECRET
  );
  setQueryMock(async () => ({
    rows: [{ id: "user-a", email: "patient@example.com", role: "patient" }],
  }));
  const req: any = {
    headers: { authorization: `Bearer ${token}` },
  };
  const res = createResponse();
  let nextCalled = false;

  await authenticateToken(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(req.user.role, "patient");
  const denied = createResponse();
  requireRole("admin")(req, denied, () => {
    throw new Error("next must not be called");
  });
  assert.equal(denied.statusCode, 403);
});

test("JWTs with an unsupported role are rejected", async () => {
  process.env.JWT_SECRET = "test-jwt-secret";
  const token = jwt.sign(
    { id: "user-a", email: "patient@example.com", role: "superuser" },
    process.env.JWT_SECRET
  );
  const res = createResponse();

  await authenticateToken({
    headers: { authorization: `Bearer ${token}` },
  } as any, res, () => {
    throw new Error("next must not be called");
  });

  assert.equal(res.statusCode, 401);
});
