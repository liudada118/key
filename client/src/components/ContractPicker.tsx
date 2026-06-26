import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { FileText, Loader2, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export type ContractValue = { contractId?: number; contractNo?: string };

/**
 * 关联合同（可选）选择器：选已有 ACTIVE 合同，或内联新建合同（仅合同、无客户）。
 * 与生成密钥里那套一致，且与合同管理共用同一张 contracts 表。
 */
export function ContractPicker({
  value,
  onChange,
}: {
  value: ContractValue;
  onChange: (next: ContractValue) => void;
}) {
  const utils = trpc.useUtils();
  const { data: contractData } = trpc.contracts.list.useQuery({ page: 1, pageSize: 100, status: "ACTIVE" });
  const contractList = contractData?.items ?? [];

  const [showNew, setShowNew] = useState(false);
  const [newNo, setNewNo] = useState("");
  const [newTitle, setNewTitle] = useState("");

  const createMutation = trpc.contracts.create.useMutation({
    onSuccess: (data: any) => {
      const c = data?.contract ?? data;
      if (c?.id) {
        onChange({ contractId: c.id, contractNo: c.contractNo || newNo });
      }
      setShowNew(false);
      setNewNo("");
      setNewTitle("");
      utils.contracts.list.invalidate();
      toast.success("合同创建成功");
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="space-y-1.5">
      <Label className="text-foreground text-sm flex items-center gap-1">
        <FileText className="h-3.5 w-3.5" />
        关联合同（可选）
      </Label>
      {!showNew ? (
        <div className="space-y-2">
          <Select
            value={value.contractId ? String(value.contractId) : "none"}
            onValueChange={(v) => {
              if (v === "none") {
                onChange({ contractId: undefined, contractNo: "" });
              } else {
                const id = parseInt(v);
                const c = contractList.find((c: any) => c.id === id);
                onChange({ contractId: id, contractNo: c?.contractNo || "" });
              }
            }}
          >
            <SelectTrigger className="bg-secondary/50">
              <SelectValue placeholder="选择合同（可不选）" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">不关联合同</SelectItem>
              {contractList.map((c: any) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.contractNo} - {c.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-xs w-full"
            onClick={() => setShowNew(true)}
          >
            <Plus className="h-3 w-3 mr-1" />
            新建合同
          </Button>
        </div>
      ) : (
        <div className="space-y-2 p-3 bg-secondary/30 rounded-lg border border-border/50">
          <Input
            placeholder="合同编号 *"
            value={newNo}
            onChange={(e) => setNewNo(e.target.value)}
            maxLength={128}
            className="bg-secondary/50 h-8 text-sm"
          />
          <Input
            placeholder="合同标题 *"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            maxLength={256}
            className="bg-secondary/50 h-8 text-sm"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              className="h-7 text-xs flex-1"
              disabled={!newNo.trim() || !newTitle.trim() || createMutation.isPending}
              onClick={() => {
                createMutation.mutate({
                  contractNo: newNo.trim(),
                  title: newTitle.trim(),
                  status: "ACTIVE",
                });
              }}
            >
              {createMutation.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
              创建
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => {
                setShowNew(false);
                setNewNo("");
                setNewTitle("");
              }}
            >
              取消
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
