export const CAREGIVER_PERMISSIONS = [
  "view_care_plan",
  "view_tasks",
  "update_tasks",
  "view_follow_ups",
  "view_medical_tests",
  "view_medications",
];

export const relationshipLabel = (relationship, currentUserId) => {
  if (relationship.status === "revoked") return "Access revoked";
  if (relationship.status === "rejected") return "Invitation rejected";
  if (relationship.status === "pending") {
    return relationship.caregiver_id === currentUserId ? "Invitation received" : "Invitation pending";
  }
  return relationship.caregiver_id === currentUserId ? "Connected patient" : "Connected caregiver";
};

export const permissionChecked = (permissions, permission) =>
  Array.isArray(permissions) && permissions.includes(permission);
