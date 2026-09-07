import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { FileText } from "lucide-react";

export type ContractValue = { contractId?: number; contractNo?: string };

/**
 * 飞书合同只读选择器。子账号的可选项由后端按账号姓名与提交人匹配。
 */
export function ContractPicker({
  value,
  onChange,
}: {
  value: ContractValue;
  onChange: (next: ContractValue) => void;
}) {
  const { data: contractData, isLoading } = trpc.contracts.list.useQuery({
    page: 1,
    pageSize: 100,
    status: "ACTIVE",
    source: "feishu",
  });
  const contractList = contractData?.items ?? [];
  const sourceError = contractData && "error" in contractData
    ? contractData.error
    : undefined;

  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1 text-sm text-foreground">
        <FileText className="h-3.5 w-3.5" />
        关联合同（可选）
      </Label>
      <Select
        value={value.contractId ? String(value.contractId) : "none"}
        onValueChange={(selected) => {
          if (selected === "none") {
            onChange({ contractId: undefined, contractNo: "" });
            return;
          }

          const id = Number(selected);
          const contract = contractList.find((item) => item.id === id);
          onChange({ contractId: id, contractNo: contract?.contractNo || "" });
        }}
      >
        <SelectTrigger className="bg-secondary/50">
          <SelectValue placeholder="选择飞书合同（可不选）" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">不关联合同</SelectItem>
          {sourceError ? (
            <SelectItem value="feishu-error" disabled>
              {sourceError}
            </SelectItem>
          ) : isLoading ? (
            <SelectItem value="feishu-loading" disabled>
              正在读取飞书合同
            </SelectItem>
          ) : contractList.length === 0 ? (
            <SelectItem value="feishu-empty" disabled>
              暂无匹配的生效合同
            </SelectItem>
          ) : (
            contractList.map((contract) => (
              <SelectItem key={contract.id} value={String(contract.id)}>
                {contract.contractNo}
                {contract.customerName ? ` - ${contract.customerName}` : ""}
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
    </div>
  );
}
