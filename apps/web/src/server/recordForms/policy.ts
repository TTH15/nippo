import type { RecordForm, FormGrant } from "@/lib/recordForms/model";
export type Actor = {
  id: string;
  orgId: string;
  roleId: string | null;
  name: string;
  manager: boolean;
  worksAsDriver: boolean;
};
export type Scope = "staff" | "self" | "manage";
export function grantFor(
  form: RecordForm,
  actor: Actor,
  scope: Scope,
): FormGrant {
  const access =
    scope !== "self"
      ? actor.manager
        ? "edit"
        : actor.roleId
          ? form.access[actor.roleId]
          : "none"
      : "none";
  const self = scope === "self" && actor.worksAsDriver;
  return {
    create: access === "edit" || (self && form.driver.submit),
    readAll: access === "view" || access === "edit",
    editAll: access === "edit",
    readOwn: self && form.driver.readOwn,
    editOwn: self && form.driver.readOwn && form.driver.editOwn,
    readSubject: self && form.driver.readSubject,
  };
}
export function canRead(
  grant: FormGrant,
  actorId: string,
  author: string,
  subject: string | null,
) {
  return (
    grant.readAll ||
    (grant.readOwn && actorId === author) ||
    (grant.readSubject && actorId === subject)
  );
}
export function canEdit(grant: FormGrant, actorId: string, author: string) {
  return grant.editAll || (grant.editOwn && actorId === author);
}
/** 閲覧者に運営側ロールの設定を返さない。保存版にも適用する。 */
export function visibleSchema(form: RecordForm, manager: boolean): RecordForm {
  return manager ? form : { ...form, access: {} };
}
