import { randomBytes, createHash } from "node:crypto";
const digest = (value) => createHash("sha256").update(value).digest("hex");
const error = (status, message) =>
  Object.assign(new Error(message), { status });

// Short-lived, single-use grants. Never store or log a raw API token here.
export function createClipperPairing(db, issueToken) {
  const grants = new Map();
  const prune = () => {
    for (const [key, grant] of grants)
      if (grant.until <= Date.now()) grants.delete(key);
  };
  return {
    issue(req, res) {
      prune();
      if (req.auth.kind !== "session" || req.auth.scope !== "admin")
        throw error(403, "请在已登录的 ZNote 网页中连接扩展");
      if (grants.size >= 100) throw error(429, "连接请求过多，请稍后重试");
      const code = randomBytes(32).toString("hex");
      grants.set(digest(code), {
        session: req.auth.id,
        until: Date.now() + 120000,
      });
      res.set("Cache-Control", "no-store").json({ code });
    },
    redeem(req, res) {
      prune();
      if (!/^chrome-extension:\/\/[a-p]{32}$/.test(req.headers.origin || ""))
        throw error(403, "仅允许浏览器扩展完成连接");
      const code = req.body?.code;
      if (typeof code !== "string" || !/^[a-f0-9]{64}$/.test(code))
        throw error(400, "连接凭据无效");
      const key = digest(code),
        grant = grants.get(key);
      const session =
        grant &&
        db
          .prepare(
            "SELECT * FROM tokens WHERE id=? AND kind='session' AND scope='admin'",
          )
          .get(grant.session);
      if (
        !grant ||
        !session ||
        (session.expires_at && session.expires_at <= new Date().toISOString())
      )
        throw error(401, "连接已过期，请在 ZNote 重新点击连接");
      grants.delete(key);
      res
        .set("Access-Control-Allow-Origin", req.headers.origin)
        .set("Cache-Control", "no-store")
        .json(issueToken("浏览器采集扩展", "write", "api"));
    },
  };
}
