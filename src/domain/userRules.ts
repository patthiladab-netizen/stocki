export type UserRow = { id: number; role: string; is_active: number | boolean };
export type UserPatch = { role?: "OWNER" | "STAFF"; is_active?: boolean; password?: string };

export function checkUserChange(args: {
  actorId: number;
  target: UserRow;
  patch: UserPatch;
  activeOwners: number;
}): "cannot_change_self" | "last_owner" | null {
  const { actorId, target, patch, activeOwners } = args;
  const demotes = patch.role !== undefined && patch.role !== "OWNER";
  const deactivates = patch.is_active === false;
  if (target.id === actorId && (demotes || deactivates)) return "cannot_change_self";
  const isActiveOwner = target.role === "OWNER" && !!target.is_active;
  if (isActiveOwner && (demotes || deactivates) && activeOwners <= 1) return "last_owner";
  return null;
}
