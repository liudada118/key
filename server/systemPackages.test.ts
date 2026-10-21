import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { activeReleases, checkSystemPackageIdentity, publicationBaseline, readWithdrawalPolicy, rolloutToken, systemPackageDiff, validateSystemPackage, visibleReleases } from "./systemPackages";

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
  it("keeps legacy withdrawal semantics but fails closed on corrupt explicit policy", () => {
    expect(readWithdrawalPolicy().mode).toBe("stop-distribution");
    expect(readWithdrawalPolicy({ detailsJson: '{"effect":"hide-on-next-sync"}' }).mode).toBe("stop-distribution");
    expect(readWithdrawalPolicy({ detailsJson: '{"withdrawal":{"schemaVersion":99,"mode":"stop-distribution"}}' }).mode).toBe("stop-new-acquisition");
    expect(readWithdrawalPolicy({ detailsJson: "corrupt" }).mode).toBe("stop-new-acquisition");
  });
  it("freezes a first or legacy default without promoting later candidates or undoing withdrawal", () => {
    expect(publicationBaseline([{ id: 9, status: "pending" }], [], 9)).toBe(9);
    const revisions = [{ id: 9, status: "pending" }, { id: 8, status: "published" }, { id: 7, status: "published" }];
    expect(publicationBaseline(revisions, [], 9)).toBe(8);
    expect(publicationBaseline(revisions, [{ customerId: 7 }], 9)).toBe(8);
    expect(publicationBaseline(revisions, [{ customerId: 0 }], 9)).toBeNull();
    expect(publicationBaseline([{ id: 9, status: "pending" }, { id: 8, status: "revoked" }], [], 9)).toBe(8);
  });
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
    const reserved = { ...payload, systemId: "hand", template: { ...payload.template, id: "hand" } };
    expect(() => validateSystemPackage({ ...reserved,
      sha256: createHash("sha256").update(JSON.stringify(reserved)).digest("hex") })).toThrow("SYSTEM_ID_RESERVED");
  });

  it("filters published versions by license scope without requiring historical audience membership", () => {
    const rows = [
      { systemId: "seatpad", status: "revoked", audienceJson: '"all"', version: 3 },
      { systemId: "seatpad", status: "published", audienceJson: "[42]", version: 2 },
      { systemId: "seatpad", status: "published", audienceJson: '"all"', version: 1 },
    ];
    expect(visibleReleases(rows, 42)[0].version).toBe(2);
    expect(visibleReleases(rows, 7)[0].version).toBe(2);
    expect(visibleReleases(rows, null, ["seatpad"])[0].version).toBe(2);
    expect(visibleReleases(rows, 42, [])).toEqual([]);
    expect(visibleReleases(rows, 42, ["seatpad"])[0].version).toBe(2);
  });

  it("lets unlinked authorized keys fetch customer-only published systems without bypassing rollout withdrawal", () => {
    const rows = [
      { id: 4, systemId: "other", status: "published", audienceJson: "[7]" },
      { id: 3, systemId: "seatpad", status: "published", audienceJson: "[42]" },
      { id: 2, systemId: "seatpad", status: "published", audienceJson: "[42]" },
      { id: 1, systemId: "seatpad", status: "published", audienceJson: "[42]" },
    ];
    expect(activeReleases(rows, [], null, ["seatpad"]).map((item) => item.id)).toEqual([3]);
    expect(activeReleases(rows, [{ systemId: "seatpad", customerId: 42, versionId: 2 }], null, ["seatpad"])
      .map((item) => item.id)).toEqual([3]);
    expect(activeReleases(rows, [{ systemId: "seatpad", customerId: 0, versionId: 1 }], null, ["seatpad"])
      .map((item) => item.id)).toEqual([1]);
    expect(activeReleases(rows, [{ systemId: "seatpad", customerId: 0, versionId: 99 }], null, ["seatpad"]))
      .toEqual([]);
    const withdrawn = [{ ...rows[1], status: "revoked" }, ...rows.slice(2)];
    expect(activeReleases(withdrawn, [{ systemId: "seatpad", customerId: 0, versionId: 3 }], null, ["seatpad"]))
      .toEqual([]);
    expect(activeReleases(rows, [], null, [])).toEqual([]);
    expect(activeReleases(rows, [], null, ["hand"])).toEqual([]);
  });

  it("resolves customer overrides before the global release and never leaks inactive versions", () => {
    const rows = [
      { id: 3, systemId: "seatpad", status: "published", audienceJson: "[42]" },
      { id: 2, systemId: "seatpad", status: "published", audienceJson: '"all"' },
      { id: 1, systemId: "seatpad", status: "published", audienceJson: '"all"' },
    ];
    const pointers = [{ systemId: "seatpad", customerId: 0, versionId: 2 },
      { systemId: "seatpad", customerId: 42, versionId: 1 }];
    expect(activeReleases(rows, pointers, 42)[0].id).toBe(1);
    expect(activeReleases(rows, pointers, 7)[0].id).toBe(2);
    expect(activeReleases(rows, pointers, 7, [])).toEqual([]);
    expect(activeReleases(rows, [], 42)[0].id).toBe(3);
    expect(activeReleases(rows, [{ systemId: "seatpad", customerId: 42, versionId: 99 }], 42)).toEqual([]);
    expect(activeReleases([{ ...rows[0], status: "revoked" }, ...rows.slice(1)],
      [{ systemId: "seatpad", customerId: 42, versionId: 3 }], 42)).toEqual([]);
    expect(rolloutToken(pointers)).toBe(rolloutToken([...pointers].reverse()));
  });

  it("requires an explicit current version for an update and rejects identity changes", () => {
    const previous = { id: 7, packageJson: JSON.stringify({ kind: "native-template", template: { sourceType: "hand" } }) };
    const update = { kind: "native-template", template: { sourceType: "hand" } };
    expect(checkSystemPackageIdentity(update, undefined, previous)).toEqual({ error: "SYSTEM_ID_ALREADY_PUBLISHED", currentVersion: 7 });
    expect(checkSystemPackageIdentity(update, 6, previous)).toEqual({ error: "SYSTEM_ID_ALREADY_PUBLISHED", currentVersion: 7 });
    expect(checkSystemPackageIdentity(update, 7, previous)).toBeNull();
    expect(checkSystemPackageIdentity({ kind: "manifest" }, 7, previous)).toEqual({ error: "SYSTEM_ID_INCOMPATIBLE", currentVersion: 7 });
    expect(checkSystemPackageIdentity({ kind: "native-template", template: { sourceType: "jqbed" } }, 7, previous))
      .toEqual({ error: "SYSTEM_ID_INCOMPATIBLE", currentVersion: 7 });
    expect(checkSystemPackageIdentity(update, 7)).toEqual({ error: "SYSTEM_UPDATE_TARGET_MISSING" });
    expect(checkSystemPackageIdentity(update, undefined)).toBeNull();
  });

  it("blocks frame-identity changes while allowing reviewed protocol and line-order updates", () => {
    const manifest = { id: "seatpad", name: "坐垫", sensors: [{ id: "s1", type: "seatpad-s1",
      outputChannel: "s1", matrix: { rows: 23, cols: 23 }, protocol: { decoding: { valueCount: 1024 } },
      files: { lineOrder: "custom-order.json" } }] };
    const pack = (value: any, line: number[]) => {
      const data = Buffer.from(JSON.stringify(value));
      const order = Buffer.from(JSON.stringify(line));
      const payload = { schemaVersion: 1, kind: "manifest", systemId: "seatpad", bindings: null, algorithms: [],
        files: [{ path: "display-system.json", size: data.length, sha256: createHash("sha256").update(data).digest("hex"), contentBase64: data.toString("base64") },
          { path: "s1/custom-order.json", size: order.length, sha256: createHash("sha256").update(order).digest("hex"), contentBase64: order.toString("base64") }] };
      return { ...payload, sha256: createHash("sha256").update(JSON.stringify(payload)).digest("hex") };
    };
    const first = pack(manifest, [1, 2]);
    const tuned = pack({ ...manifest, sensors: [{ ...manifest.sensors[0], protocol: { decoding: { valueCount: 2048 } } }] }, [2, 1]);
    expect(systemPackageDiff(first, tuned)).toMatchObject({ dataContractChanged: false,
      protocolChanged: true, lineOrderChanged: true });
    expect(checkSystemPackageIdentity(tuned, 8, { id: 8, packageJson: JSON.stringify(first) })).toBeNull();
    const resized = pack({ ...manifest, sensors: [{ ...manifest.sensors[0], matrix: { rows: 24, cols: 23 } }] }, [1, 2]);
    expect(checkSystemPackageIdentity(resized, 8, { id: 8, packageJson: JSON.stringify(first) }))
      .toEqual({ error: "SYSTEM_ID_DATA_CONTRACT_CHANGED", currentVersion: 8 });
    const implicitOutput = pack({ ...manifest, sensors: [{ ...manifest.sensors[0], outputChannel: undefined }] }, [1, 2]);
    expect(systemPackageDiff(first, implicitOutput).dataContractChanged).toBe(false);
    const legacy = pack({ id: "seatpad", name: "坐垫", sensor: { ports: ["s1"], type: "seatpad-s1",
      matrix: { rows: 23, cols: 23 }, protocol: manifest.sensors[0].protocol, files: manifest.sensors[0].files } }, [1, 2]);
    expect(systemPackageDiff(legacy, implicitOutput).dataContractChanged).toBe(false);
  });
});
