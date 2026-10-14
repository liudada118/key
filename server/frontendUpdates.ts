import { type Express } from "express";
import { createPublicKey, verify } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

/** Serve immutable signed frontend files; missing publication keeps clients on their local page. */
export function registerFrontendUpdates(app: Express) {
  const directory = () => process.env.SHROOM_FRONTEND_RELEASE_DIR;
  app.get("/api/frontend/latest", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const root = directory(), signingKey = process.env.SHROOM_SYSTEM_PACKAGE_SIGNING_KEY_PATH;
      if (!root || !signingKey) throw new Error("unconfigured");
      const envelope = JSON.parse(readFileSync(path.join(root, "latest.json"), "utf8"));
      if (!verify(null, Buffer.from(JSON.stringify(envelope.manifest)), createPublicKey(readFileSync(signingKey)), Buffer.from(envelope.signature, "base64"))) throw new Error("invalid");
      res.json(envelope);
    } catch { res.status(503).json({ error: "FRONTEND_RELEASE_UNAVAILABLE" }); }
  });
  app.get("/api/frontend/releases/:id/*", (req, res) => {
    try {
      const root = directory(), name = (req.params as Record<string, string>)[0], id = req.params.id;
      if (!root || !/^[1-9]\d{0,15}$/.test(id) || !name || /[\\:\x00-\x1f%]/.test(name)
        || name.split("/").some(part => !part || part.startsWith(".") || /[. ]$/.test(part))) throw new Error("invalid");
      const envelope = JSON.parse(readFileSync(path.join(root, id, "release.json"), "utf8"));
      if (!envelope.manifest.files.some((file: { path: string }) => file.path === name)) throw new Error("missing");
      const target = path.resolve(root, id, name), base = path.resolve(root, id);
      if (!target.startsWith(base + path.sep) || !statSync(target).isFile()) throw new Error("missing");
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.sendFile(target);
    } catch { res.status(404).json({ error: "FRONTEND_RESOURCE_NOT_FOUND" }); }
  });
}
