import { createHmac, hkdfSync } from "node:crypto";
import { z } from "zod";
import { ConnectError } from "../../../composio-connect";
export function createHttpCorrelation(key: Uint8Array) {
  if (!(key instanceof Uint8Array) || key.byteLength !== 32)
    throw new ConnectError("CONNECT_UNAVAILABLE");
  const derived = Buffer.from(
    hkdfSync("sha256", Buffer.from(key), "crm-composio", "http-begin-v1", 32),
  );
  function uuid(hex: string) {
    const s = hex.slice(0, 32).split("");
    s[12] = "4";
    s[16] = ((parseInt(s[16], 16) & 3) | 8).toString(16);
    const v = s.join("");
    return `${v.slice(0, 8)}-${v.slice(8, 12)}-${v.slice(12, 16)}-${v.slice(16, 20)}-${v.slice(20)}`;
  }
  return (
    session: { actor_id: string; session_id: string },
    requestKey: string,
  ) => {
    z.uuid().parse(session.actor_id);
    z.uuid().parse(session.session_id);
    z.uuid().parse(requestKey);
    const digest = (slot: string) =>
      createHmac("sha256", derived)
        .update(
          JSON.stringify([
            slot,
            session.actor_id,
            session.session_id,
            requestKey,
          ]),
        )
        .digest("hex");
    const id = uuid(digest("attempt"));
    return {
      id,
      proof: digest("browser-proof"),
      state: id + "_" + digest("state"),
      callbackKey: uuid(digest("callback-receipt")),
    };
  };
}
