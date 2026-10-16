import React from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button, ButtonSpinner } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

export function OrganizationExportButton() {
  const { user } = useAuth();
  const mutation = trpc.accounts.exportOrganization.useMutation({
    onSuccess: snapshot => {
      let url: string | undefined;
      const link = document.createElement("a");
      try {
        url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json;charset=utf-8" }));
        link.href = url;
        link.download = `accounts-departments-${snapshot.exportedAt.replace(/[:.]/g, "-")}.json`;
        document.body.appendChild(link);
        link.click();
        toast.success(`已导出 ${snapshot.counts.accounts} 个账号、${snapshot.counts.departments} 个部门`);
      } catch {
        toast.error("导出文件下载失败，请重试");
      } finally {
        link.remove();
        if (url) window.setTimeout(() => URL.revokeObjectURL(url!), 1000);
      }
    },
    onError: error => toast.error(error.message),
  });
  if (user?.role !== "super_admin" || !user.isActive) return null;
  return (
    <Button variant="outline" className="h-11 gap-2" title="导出账号及部门（JSON）"
      disabled={mutation.isPending} aria-busy={mutation.isPending} onClick={() => mutation.mutate()}>
      <Download key="icon" aria-hidden="true" className={mutation.isPending ? "hidden" : "h-4 w-4"} />
      <ButtonSpinner key="spinner" pending={mutation.isPending} />
      <span key="label">一键导出</span>
    </Button>
  );
}
