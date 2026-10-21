import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type KeyGenerationGateDialog from "@/components/KeyGenerationGateDialog";

const fixture = vi.hoisted(() => ({
  mode: "single" as "single" | "batch",
  product: "shroom-sdk",
  role: "user",
  pending: false,
  launch: undefined as React.ComponentProps<"button"> | undefined,
  dialog: undefined as React.ComponentProps<typeof KeyGenerationGateDialog> | undefined,
  generate: vi.fn(),
  batchGenerate: vi.fn(),
  error: vi.fn(),
}));

// Capture real page actions without a DOM or issuing keys against a database.
vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      const [value] = actual.useState(initial === "shroom-desktop" ? fixture.product : initial);
      return [value, vi.fn()];
    },
  };
});
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: { role: fixture.role } }) }));
vi.mock("sonner", () => ({ toast: { error: fixture.error, success: vi.fn() } }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({}),
    sensors: {
      groups: { useQuery: () => ({ data: [], isLoading: false }) },
      licenseGroups: { useQuery: () => ({ data: { groups: [] } }) },
    },
    contracts: {
      list: { useQuery: () => ({ data: { items: [] }, isLoading: false }) },
      policy: { useQuery: () => ({ data: { requireContract: false } }) },
    },
    keys: {
      generate: { useMutation: () => ({ mutate: fixture.generate, isPending: fixture.pending }) },
      batchGenerate: { useMutation: () => ({ mutate: fixture.batchGenerate, isPending: fixture.pending }) },
    },
  },
}));
vi.mock("@/components/ui/tabs", async importOriginal => {
  const actual = await importOriginal<typeof import("@/components/ui/tabs")>();
  return {
    ...actual,
    Tabs: (props: React.ComponentProps<typeof actual.Tabs>) =>
      <actual.Tabs {...props} defaultValue={fixture.mode} />,
  };
});
vi.mock("@/components/ui/button", async importOriginal => {
  const actual = await importOriginal<typeof import("@/components/ui/button")>();
  return {
    ...actual,
    Button: (props: React.ComponentProps<typeof actual.Button>) => {
      if (props.size === "lg") fixture.launch = props;
      return <actual.Button {...props} />;
    },
  };
});
vi.mock("@/components/KeyGenerationGateDialog", () => ({
  default: (props: React.ComponentProps<typeof KeyGenerationGateDialog>) => {
    fixture.dialog = props;
    return null;
  },
}));

import GenerateKey from "./GenerateKey";

beforeEach(() => {
  vi.clearAllMocks();
  fixture.mode = "single";
  fixture.product = "shroom-sdk";
  fixture.role = "user";
  fixture.pending = false;
  fixture.launch = undefined;
  fixture.dialog = undefined;
  vi.stubGlobal("React", React);
  vi.stubGlobal("window", { location: { search: "" } });
});

afterEach(() => vi.unstubAllGlobals());

describe("online generation contract choice", () => {
  it.each(["single", "batch"] as const)("opens the dialog before %s issuance even when contracts are optional", mode => {
    fixture.mode = mode;
    const html = renderToStaticMarkup(<GenerateKey />);
    fixture.launch!.onClick!({} as React.MouseEvent<HTMLButtonElement>);
    expect(fixture.dialog!.onOpenChange).toHaveBeenCalledWith(true);
    expect(fixture.generate).not.toHaveBeenCalled();
    expect(fixture.batchGenerate).not.toHaveBeenCalled();
    expect(html).toContain('aria-haspopup="dialog"');
    expect(fixture.dialog!.canGenerateWithoutContract).toBe(false);
  });

  it.each(["admin", "user"])("requires a no-contract request for the %s role", role => {
    fixture.role = role;
    renderToStaticMarkup(<GenerateKey />);
    fixture.launch!.onClick!({} as React.MouseEvent<HTMLButtonElement>);
    expect(fixture.dialog!.onOpenChange).toHaveBeenCalledWith(true);
    expect(fixture.dialog!.canGenerateWithoutContract).toBe(false);
    expect(fixture.generate).not.toHaveBeenCalled();
  });

  it("keeps the super administrator exemption inside the dialog", () => {
    fixture.role = "super_admin";
    renderToStaticMarkup(<GenerateKey />);
    fixture.launch!.onClick!({} as React.MouseEvent<HTMLButtonElement>);
    expect(fixture.dialog!.onOpenChange).toHaveBeenCalledWith(true);
    expect(fixture.dialog!.canGenerateWithoutContract).toBe(true);
    expect(fixture.dialog!.isSuperAdmin).toBe(true);
    expect(fixture.generate).not.toHaveBeenCalled();
  });

  it.each(["single", "batch"] as const)("only issues %s after confirmation with the selected contract", mode => {
    fixture.mode = mode;
    renderToStaticMarkup(<GenerateKey />);
    fixture.dialog!.onGenerateWithContract({ id: 12, contractNo: "HT-12", customerName: "客户甲" });
    const mutation = mode === "single" ? fixture.generate : fixture.batchGenerate;
    expect(mutation).toHaveBeenCalledWith(expect.objectContaining({
      contractId: 12, contractNo: "HT-12", productType: "shroom-sdk", sensorTypes: "all", days: 30,
      ...(mode === "batch" ? { count: 10 } : {}),
    }));
  });

  it("preserves the no-contract note and never issues on cancel", () => {
    renderToStaticMarkup(<GenerateKey />);
    fixture.dialog!.onOpenChange(false);
    expect(fixture.generate).not.toHaveBeenCalled();
    fixture.dialog!.onGenerateWithoutContract("展会演示");
    expect(fixture.generate).toHaveBeenCalledWith(expect.objectContaining({ remark: "展会演示", days: 30 }));
    expect(fixture.generate.mock.calls[0][0]).not.toHaveProperty("contractId");
  });

  it("validates scope before opening the dialog and disables a pending launch", () => {
    fixture.product = "shroom-desktop";
    renderToStaticMarkup(<GenerateKey />);
    fixture.launch!.onClick!({} as React.MouseEvent<HTMLButtonElement>);
    expect(fixture.error).toHaveBeenCalled();
    expect(fixture.dialog!.onOpenChange).not.toHaveBeenCalled();
    fixture.pending = true;
    renderToStaticMarkup(<GenerateKey />);
    expect(fixture.launch!.disabled).toBe(true);
    expect(fixture.dialog!.directGenerationPending).toBe(true);
  });
});
