import { scenario } from "./services";
let attempted = false;
async function response() {
  if (scenario === "cancel" && !attempted) { attempted = true; throw { error: "UserCancelled" }; }
  return { id: "preview-only", response: {} };
}
export const Passkey = { isSupported: () => scenario !== "unsupported", create: response, get: response };
