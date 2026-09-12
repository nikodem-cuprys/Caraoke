const STORAGE_KEY = "singlearn_client_id";

/**
 * SingLearn has no real accounts in this MVP (see README "Known
 * Limitations"). Instead, each browser generates a random client id on
 * first visit and sends it as X-Client-Id, which the API uses to scope
 * song ownership/library access. This is not a security boundary against a
 * determined attacker who forges the header -- it exists to give each
 * visitor their own library and prevent accidental cross-user edits, not to
 * authenticate a real identity.
 */
export function getClientId(): string {
  if (typeof window === "undefined") return "server";
  let id = window.localStorage.getItem(STORAGE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(STORAGE_KEY, id);
  }
  return id;
}
