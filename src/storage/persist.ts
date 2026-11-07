export async function requestPersistence(): Promise<"granted" | "denied" | "unsupported"> {
  const storage = typeof navigator === "undefined" ? undefined : navigator.storage;
  if (!storage?.persist) return "unsupported";
  if (storage.persisted && (await storage.persisted())) return "granted";
  return (await storage.persist()) ? "granted" : "denied";
}
