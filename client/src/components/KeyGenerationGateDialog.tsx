import { Badge } from "@/components/ui/badge";
import { Button, ButtonSpinner } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import {
  Building2,
  ClipboardCheck,
  FileCheck2,
  FileText,
  Loader2,
  Search,
  UserRound,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

export type GenerationContract = {
  id: number;
  contractNo: string;
  customerName: string | null;
  businessUnit?: string | null;
  submitter?: string | null;
  generatedKeyCount?: number;
};

type KeyGenerationGateDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contracts: GenerationContract[];
  contractsLoading: boolean;
  contractsError?: string;
  mode: "single" | "batch";
  sensorTypes: string | string[];
  sensorSummary: string;
  days: number;
  count: number;
  category: "production" | "rental";
  generationRemark?: string;
  canGenerateWithoutContract: boolean;
  directGenerationPending: boolean;
  onGenerateWithContract: (contract: GenerationContract) => void;
  onGenerateWithoutContract: (note?: string) => void;
  onRequestSubmitted?: () => void;
};

type ContractGroup = "ungenerated" | "generated";
type GenerationPath = "contract" | "request";

export default function KeyGenerationGateDialog({
  open,
  onOpenChange,
  contracts,
  contractsLoading,
  contractsError,
  mode,
  sensorTypes,
  sensorSummary,
  days,
  count,
  category,
  generationRemark,
  canGenerateWithoutContract,
  directGenerationPending,
  onGenerateWithContract,
  onGenerateWithoutContract,
  onRequestSubmitted,
}: KeyGenerationGateDialogProps) {
  const [generationPath, setGenerationPath] =
    useState<GenerationPath>("contract");
  const [contractGroup, setContractGroup] =
    useState<ContractGroup>("ungenerated");
  const [selectedContractId, setSelectedContractId] = useState<number>();
  const [search, setSearch] = useState("");
  const [reason, setReason] = useState("");
  const utils = trpc.useUtils();

  const requestMutation = trpc.keyGenerationRequests.create.useMutation({
    onSuccess: async (request) => {
      onOpenChange(false);
      onRequestSubmitted?.();
      await utils.keyGenerationRequests.list.invalidate();
      toast.success(`申请 ${request?.requestNo || ""} 已提交`);
    },
    onError: (error) => toast.error(error.message),
  });

  useEffect(() => {
    if (!open) {
      setGenerationPath("contract");
      setContractGroup("ungenerated");
      setSelectedContractId(undefined);
      setSearch("");
      setReason("");
    }
  }, [open]);

  const selectedContract = useMemo(
    () => contracts.find((contract) => contract.id === selectedContractId),
    [contracts, selectedContractId],
  );

  const normalizedSearch = search.trim().toLocaleLowerCase("zh-CN");
  const filteredContracts = useMemo(() => {
    return contracts.filter((contract) => {
      const isGenerated = (contract.generatedKeyCount || 0) > 0;
      if (
        (contractGroup === "generated" && !isGenerated) ||
        (contractGroup === "ungenerated" && isGenerated)
      ) {
        return false;
      }
      if (!normalizedSearch) return true;
      return [
        contract.contractNo,
        contract.customerName,
        contract.businessUnit,
        contract.submitter,
      ].some((value) =>
        value?.toLocaleLowerCase("zh-CN").includes(normalizedSearch),
      );
    });
  }, [contractGroup, contracts, normalizedSearch]);

  const ungeneratedCount = contracts.filter(
    (contract) => (contract.generatedKeyCount || 0) === 0,
  ).length;
  const generatedCount = contracts.length - ungeneratedCount;
  const isPending = directGenerationPending || requestMutation.isPending;

  const submitRequest = () => {
    const trimmedReason = reason.trim();
    if (canGenerateWithoutContract) {
      onGenerateWithoutContract(trimmedReason || undefined);
      return;
    }
    if (trimmedReason.length < 2) {
      toast.error("请填写无合同生成原因");
      return;
    }
    requestMutation.mutate({
      mode,
      sensorTypes,
      days,
      category,
      count: mode === "batch" ? count : undefined,
      reason: trimmedReason,
      generationRemark: generationRemark?.trim() || undefined,
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isPending) onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="grid max-h-[92vh] grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="border-b px-6 py-5 pr-12">
          <DialogTitle>确认生成方式</DialogTitle>
          <DialogDescription className="sr-only">
            绑定飞书合同后生成密钥，或处理无合同生成。
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 border-b bg-muted/25 text-sm">
          <div className="border-r px-4 py-3">
            <p className="text-xs text-muted-foreground">生成方式</p>
            <p className="mt-1 font-medium">
              {mode === "single" ? "单个" : `批量 ${count} 个`}
            </p>
          </div>
          <div className="border-r px-4 py-3">
            <p className="text-xs text-muted-foreground">有效期</p>
            <p className="mt-1 font-medium">{days} 天</p>
          </div>
          <div className="min-w-0 px-4 py-3">
            <p className="text-xs text-muted-foreground">授权范围</p>
            <p className="mt-1 truncate font-medium" title={sensorSummary}>
              {sensorSummary}
            </p>
          </div>
        </div>

        <Tabs
          value={generationPath}
          onValueChange={(value) => setGenerationPath(value as GenerationPath)}
          className="flex min-h-0 flex-col overflow-hidden px-6 pt-5"
        >
          <TabsList className="grid w-full shrink-0 grid-cols-2">
            <TabsTrigger value="contract">
              <FileCheck2 className="mr-2 h-4 w-4" />
              绑定合同
            </TabsTrigger>
            <TabsTrigger value="request">
              <Zap
                className={
                  canGenerateWithoutContract ? "mr-2 h-4 w-4" : "hidden"
                }
              />
              <ClipboardCheck
                className={
                  canGenerateWithoutContract ? "hidden" : "mr-2 h-4 w-4"
                }
              />
              <span className={canGenerateWithoutContract ? "" : "hidden"}>
                无合同生成
              </span>
              <span className={canGenerateWithoutContract ? "hidden" : ""}>
                无合同申请
              </span>
            </TabsTrigger>
          </TabsList>

          <TabsContent
            value="contract"
            className="mt-5 flex min-h-0 flex-1 flex-col overflow-hidden"
          >
            <div className="relative mb-4 shrink-0">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索合同编号、客户、事业部或提交人"
                className="pl-9"
              />
            </div>

            <Tabs
              value={contractGroup}
              onValueChange={(value) =>
                setContractGroup(value as ContractGroup)
              }
              className="flex min-h-0 flex-1 flex-col overflow-hidden"
            >
              <TabsList className="grid w-full shrink-0 grid-cols-2">
                <TabsTrigger value="ungenerated">
                  未生成密钥
                  <Badge variant="secondary" className="ml-2 h-5 px-1.5">
                    {ungeneratedCount}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="generated">
                  已生成密钥
                  <Badge variant="secondary" className="ml-2 h-5 px-1.5">
                    {generatedCount}
                  </Badge>
                </TabsTrigger>
              </TabsList>

              <TabsContent
                value={contractGroup}
                className="mt-3 min-h-0 flex-1 overflow-hidden"
              >
                <ScrollArea className="h-full min-h-[180px] border">
                  {contractsLoading ? (
                    <div className="flex h-full min-h-[300px] items-center justify-center text-sm text-muted-foreground">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      正在读取飞书合同
                    </div>
                  ) : contractsError ? (
                    <div className="flex min-h-[300px] items-center justify-center px-6 text-center text-sm text-destructive">
                      {contractsError}
                    </div>
                  ) : filteredContracts.length === 0 ? (
                    <div className="flex min-h-[300px] items-center justify-center text-sm text-muted-foreground">
                      暂无符合条件的合同
                    </div>
                  ) : (
                    <RadioGroup
                      value={
                        selectedContractId ? String(selectedContractId) : ""
                      }
                      onValueChange={(value) =>
                        setSelectedContractId(Number(value))
                      }
                      className="gap-0"
                    >
                      {filteredContracts.map((contract) => {
                        const inputId = `generation-contract-${mode}-${contract.id}`;
                        return (
                          <label
                            key={contract.id}
                            htmlFor={inputId}
                            className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-start gap-3 border-b px-4 py-3 transition-colors last:border-b-0 hover:bg-accent/50 sm:grid-cols-[auto_minmax(0,1fr)_auto]"
                          >
                            <RadioGroupItem
                              id={inputId}
                              value={String(contract.id)}
                              className="mt-1"
                            />
                            <span className="min-w-0">
                              <span className="flex flex-wrap items-center gap-2">
                                <span className="font-mono text-sm font-medium">
                                  {contract.contractNo}
                                </span>
                                {contract.customerName && (
                                  <span className="inline-flex min-w-0 items-center gap-1 text-sm">
                                    <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                    <span className="truncate">
                                      {contract.customerName}
                                    </span>
                                  </span>
                                )}
                              </span>
                              <span className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                <span>
                                  {contract.businessUnit || "未填写事业部"}
                                </span>
                                <span className="inline-flex items-center gap-1">
                                  <UserRound className="h-3 w-3" />
                                  {contract.submitter || "未填写提交人"}
                                </span>
                              </span>
                            </span>
                            <Badge
                              variant={
                                (contract.generatedKeyCount || 0) > 0
                                  ? "outline"
                                  : "secondary"
                              }
                              className="col-start-2 w-fit whitespace-nowrap sm:col-start-auto"
                            >
                              {(contract.generatedKeyCount || 0) > 0
                                ? `${contract.generatedKeyCount} 个密钥`
                                : "未生成"}
                            </Badge>
                          </label>
                        );
                      })}
                    </RadioGroup>
                  )}
                </ScrollArea>
              </TabsContent>
            </Tabs>

            <div className="mt-4 min-h-12 shrink-0 border-l-2 border-primary bg-muted/30 px-3 py-2 text-sm">
              {selectedContract ? (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span>
                    <span className="text-muted-foreground">合同：</span>
                    <span className="font-mono font-medium">
                      {selectedContract.contractNo}
                    </span>
                  </span>
                  <span>
                    <span className="text-muted-foreground">客户：</span>
                    <span className="font-medium">
                      {selectedContract.customerName || "-"}
                    </span>
                  </span>
                </div>
              ) : (
                <span className="text-muted-foreground">请选择一个合同</span>
              )}
            </div>
          </TabsContent>

          <TabsContent
            value="request"
            className="mt-5 min-h-0 flex-1 overflow-y-auto pb-4"
          >
            <div
              className={
                canGenerateWithoutContract
                  ? "border-l-2 border-primary bg-primary/5 px-4 py-3 text-sm"
                  : "border-l-2 border-amber-500 bg-amber-500/5 px-4 py-3 text-sm"
              }
            >
              {canGenerateWithoutContract
                ? "超级管理员可直接生成，不创建审批申请。"
                : "无合同密钥需由超级管理员批准，批准后系统自动生成。"}
            </div>
            <div className="mt-5 space-y-2">
              <Label htmlFor={`no-contract-reason-${mode}`}>
                {canGenerateWithoutContract ? "无合同说明（可选）" : "申请原因"}
              </Label>
              <Textarea
                id={`no-contract-reason-${mode}`}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder={
                  canGenerateWithoutContract
                    ? "填写本次无合同生成说明"
                    : "填写未绑定合同的原因"
                }
                rows={7}
                maxLength={1000}
                className="resize-none"
              />
              <div className="text-right text-xs text-muted-foreground">
                {reason.length} / 1000
              </div>
            </div>
            {generationRemark && (
              <div className="mt-5 flex items-start gap-2 border-t pt-4 text-sm">
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div>
                  <span className="text-muted-foreground">生成备注：</span>
                  <span className="break-words">{generationRemark}</span>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter className="border-t px-6 py-4">
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button
            type="button"
            className={generationPath === "contract" ? "" : "hidden"}
            disabled={!selectedContract || isPending}
            onClick={() =>
              selectedContract && onGenerateWithContract(selectedContract)
            }
          >
            <ButtonSpinner pending={directGenerationPending} />
            <span>确认生成</span>
          </Button>
          <Button
            type="button"
            className={generationPath === "request" ? "" : "hidden"}
            disabled={
              isPending ||
              (!canGenerateWithoutContract && reason.trim().length < 2)
            }
            onClick={submitRequest}
          >
            <ButtonSpinner
              pending={
                requestMutation.isPending ||
                (canGenerateWithoutContract && directGenerationPending)
              }
            />
            <span className={canGenerateWithoutContract ? "" : "hidden"}>
              直接生成
            </span>
            <span className={canGenerateWithoutContract ? "hidden" : ""}>
              提交申请
            </span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
