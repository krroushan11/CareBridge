import assert from "node:assert/strict";
import { test } from "node:test";
import { CAREGIVER_PERMISSIONS, permissionChecked, relationshipLabel } from "../src/caregiverUtils.js";

test("caregiver permissions are explicit and checked without defaults", () => {
  assert.equal(CAREGIVER_PERMISSIONS.includes("view_care_plan"), true);
  assert.equal(permissionChecked(["view_tasks"], "view_tasks"), true);
  assert.equal(permissionChecked(undefined, "view_tasks"), false);
});

test("relationship labels reflect invitation and revocation state", () => {
  assert.equal(relationshipLabel({ status: "pending", caregiver_id: "u1" }, "u1"), "Invitation received");
  assert.equal(relationshipLabel({ status: "pending", caregiver_id: "u2" }, "u1"), "Invitation pending");
  assert.equal(relationshipLabel({ status: "accepted", caregiver_id: "u1" }, "u1"), "Connected patient");
  assert.equal(relationshipLabel({ status: "revoked", caregiver_id: "u1" }, "u1"), "Access revoked");
});
