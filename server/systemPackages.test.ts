import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { validateSystemPackage, visibleReleases } from "./systemPackages";

/** Build a small immutable export to exercise the same hash contract as the desktop client. */
function sample() {
  const data = Buffer.from(JSON.stringify({ id: "seatpad", name: "坐垫", sensors: [] }));
  const payload = { schemaVersion: 1, kind: "manifest", systemId: "seatpad",
    files: [{ path: "display-system.json", size: data.length,
      sha256: createHash("sha256").update(data).digest("hex"), contentBase64: data.toString("base64") }],
    bindings: null, algorithms: [] };
  return { ...payload, sha256: createHash("sha256").update(JSON.stringify(payload)).digest("hex") };
}

describe("system package publishing contract", () => {
  it("accepts a complete hashed export and rejects tampering or traversal", () => {
    const value = sample();
    expect(validateSystemPackage(value).name).toBe("坐垫");
    expect(() => validateSystemPackage({ ...value, systemId: "other" })).toThrow("PACKAGE_INTEGRITY");
    const escaped = { ...value, files: [{ ...value.files[0], path: "../display-system.json" }] };
    escaped.sha256 = createHash("sha256").update(JSON.stringify(((x: any) => { const { sha256, ...rest } = x; return rest; })(escaped))).digest("hex");
    expect(() => validateSystemPackage(escaped)).toThrow("INVALID_PACKAGE_FILE");
  });

  it("accepts a native template declaration without pretending it contains renderer files", () => {
    const payload = { schemaVersion: 1, kind: "native-template", systemId: "hand_copy",
      template: { id: "hand_copy", name: "手部副本", sourceType: "hand", configuration: { algorithms: [], charts: [] } }, algorithms: [] };
    const value = { ...payload, sha256: createHash("sha256").update(JSON.stringify(payload)).digest("hex") };
    expect(validateSystemPackage(value).name).toBe("手部副本");
    expect(() => validateSystemPackage({ ...value, template: { ...value.template, sourceType: "other" } })).toThrow("PACKAGE_INTEGRITY");
  });

  it("filters by customer and falls back to an older release after revocation", () => {
    const rows = [
      { systemId: "seatpad", status: "revoked", audienceJson: '"all"', version: 3 },
      { systemId: "seatpad", status: "published", audienceJson: "[42]", version: 2 },
      { systemId: "seatpad", status: "published", audienceJson: '"all"', version: 1 },
    ];
    expect(visibleReleases(rows, 42)[0].version).toBe(2);
    expect(visibleReleases(rows, 7)[0].version).toBe(1);
  });
});
