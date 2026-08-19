import { useAuth } from "@/_core/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonSpinner } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { Check, ClipboardCheck, KeyRound, Loader2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

type RequestStatus = "PENDING" | "APPROVED" | "REJECTED";
type StatusFilter = "ALL" | RequestStatus;
type ReviewDecision = "APPROVE" | "REJECT";

type GenerationRequestItem = {
  id: number;
  requestNo: string;
  mode: "single" | "batch";
  sensorTypes: string;
  days: number;
  count: number;
  reason: string;
  generationRemark: string | null;
  requestedByName: string;
  status: RequestStatus;
  reviewedByName: string | null;
  reviewRemark: string | null;
  reviewedAt: Date | string | null;
  createdAt: Date | string;
  generatedKeyCount: number;
};

const PAGE_SIZE = 20;

const STATUS_META: Record<RequestStatus, { label: string; className: string }> =
  {
    PENDING: {
      label: "待审批",
      className: "border-amber-500/30 bg-amber-500/10 text-amber-700",
    },
    APPROVED: {
      label: "已批准",
      className: "border-emerald-600/30 bg-emerald-600/10 text-emerald-700",
    },
    REJECTED: {
      label: "已拒绝",
      className: "border-destructive/30 bg-destructive/10 text-destructive",
    },
  };

function formatTime(value: Date | string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });
}

function parseStoredSensorTypes(value: string): string | string[] {
  try {
    const parsed = JSON.parse(value);
    if (
      typeof parsed === "string" ||
      (Array.isArray(parsed) &&
        parsed.every((item) => typeof item === "string"))
    ) {
      return parsed;
    }
  } catch {
    // Older or manually repaired rows may contain a plain sensor value.
  }
  return value;
}

export default function KeyGenerationRequests() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [reviewTarget, setReviewTarget] = useState<GenerationRequestItem>();
  const [reviewDecision, setReviewDecision] =
    useState<ReviewDecision>("APPROVE");
  const [reviewRemark, setReviewRemark] = useState("");
  const utils = trpc.useUtils();
  const isSuperAdmin = user?.role === "super_admin";

  const { data, isLoading, isFetching } =
    trpc.keyGenerationRequests.list.useQuery({
      page,
      pageSize: PAGE_SIZE,
      status: statusFilter === "ALL" ? undefined : statusFilter,
    });
  const { data: sensorGroups } = trpc.sensors.groups.useQuery();

  const sensorLabels = useMemo(
    () =>
      Object.fromEntries(
        (sensorGroups || [])
          .flatMap((group) => group.items)
          .map((sensor) => [sensor.value, sensor.label]),
      ),
    [sensorGroups],
  );

  const formatSensors = (storedValue: string) => {
    const parsed = parseStoredSensorTypes(storedValue);
    if (parsed === "all") return "全部传感器";
    const values = Array.isArray(parsed) ? parsed : [parsed];
    return values.map((value) => sensorLabels[value] || value).join("、");
  };

  const reviewMutation = trpc.keyGenerationRequests.review.useMutation({
    onSuccess: async (result, variables) => {
      setReviewTarget(undefined);
      setReviewRemark("");
      await Promise.all([
        utils.keyGenerationRequests.list.invalidate(),
        utils.keys.list.invalidate(),
      ]);
      toast.success(
        variables.decision === "APPROVE"
          ? `审批通过，已生成 ${result.generatedKeyCount} 个密钥`
          : "申请已拒绝",
      );
    },
    onError: (error) => toast.error(error.message),
  });

  const openReview = (
    request: GenerationRequestItem,
    decision: ReviewDecision,
  ) => {
    setReviewTarget(request);
    setReviewDecision(decision);
    setReviewRemark("");
  };

  const submitReview = () => {
    if (!reviewTarget) return;
    if (reviewDecision === "REJECT" && !reviewRemark.trim()) {
      toast.error("请填写拒绝原因");
      return;
    }
    reviewMutation.mutate({
      id: reviewTarget.id,
      decision: reviewDecision,
      remark: reviewRemark.trim() || undefined,
    });
  };

  const requests = (data?.items ?? []) as GenerationRequestItem[];
  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {isSuperAdmin ? "无合同密钥审批" : "无合同密钥申请"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isSuperAdmin
              ? "审批通过后由系统自动生成密钥"
              : "查看申请状态和审批结果"}
          </p>
        </div>
        <Badge variant="outline" className="w-fit">
          {isSuperAdmin ? "超级管理员" : "我的申请"}
        </Badge>
      </div>

      <div className="flex flex-wrap gap-2">
        {[
          { value: "ALL" as const, label: "全部" },
          { value: "PENDING" as const, label: "待审批" },
          { value: "APPROVED" as const, label: "已批准" },
          { value: "REJECTED" as const, label: "已拒绝" },
        ].map((status) => (
          <Button
            key={status.value}
            type="button"
            size="sm"
            variant={statusFilter === status.value ? "default" : "outline"}
            onClick={() => {
              setStatusFilter(status.value);
              setPage(1);
            }}
          >
            {status.label}
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardCheck className="h-4 w-4" />
            申请记录
            {data && <Badge variant="secondary">共 {data.total} 条</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>申请编号</TableHead>
                  <TableHead>申请人</TableHead>
                  <TableHead>生成参数</TableHead>
                  <TableHead>申请原因</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>提交时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={7} className="h-36 text-center">
                      <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        正在加载申请
                      </span>
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && requests.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="h-36 text-center text-sm text-muted-foreground"
                    >
                      暂无申请记录
                    </TableCell>
                  </TableRow>
                )}
                {requests.map((request) => (
                  <TableRow key={request.id}>
                    <TableCell>
                      <p className="whitespace-nowrap font-mono text-sm font-medium">
                        {request.requestNo}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {request.mode === "single"
                          ? "单个生成"
                          : `批量 ${request.count} 个`}
                      </p>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {request.requestedByName}
                    </TableCell>
                    <TableCell className="min-w-48">
                      <p
                        className="max-w-72 truncate text-sm"
                        title={formatSensors(request.sensorTypes)}
                      >
                        {formatSensors(request.sensorTypes)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {request.days} 天
                      </p>
                    </TableCell>
                    <TableCell className="min-w-52">
                      <p
                        className="max-w-72 truncate text-sm"
                        title={request.reason}
                      >
                        {request.reason}
                      </p>
                      {request.status !== "PENDING" && request.reviewRemark && (
                        <p
                          className="mt-1 max-w-72 truncate text-xs text-muted-foreground"
                          title={request.reviewRemark}
                        >
                          审批意见：{request.reviewRemark}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={STATUS_META[request.status].className}
                      >
                        {STATUS_META[request.status].label}
                      </Badge>
                      {request.status === "APPROVED" && (
                        <p className="mt-1 whitespace-nowrap text-xs text-muted-foreground">
                          已生成 {request.generatedKeyCount} 个
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {formatTime(request.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      {isSuperAdmin && request.status === "PENDING" ? (
                        <div className="flex justify-end gap-1">
                          <Button
                            type="button"
                            size="sm"
                            className="h-8"
                            onClick={() => openReview(request, "APPROVE")}
                          >
                            <Check className="mr-1 h-3.5 w-3.5" />
                            批准
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 text-destructive hover:text-destructive"
                            onClick={() => openReview(request, "REJECT")}
                          >
                            <X className="mr-1 h-3.5 w-3.5" />
                            拒绝
                          </Button>
                        </div>
                      ) : request.status === "APPROVED" ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-8"
                          onClick={() => navigate("/keys")}
                        >
                          <KeyRound className="mr-1 h-3.5 w-3.5" />
                          查看密钥
                        </Button>
                      ) : (
                        <span className="text-sm text-muted-foreground">
                          {request.reviewedByName || "-"}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            第 {page} / {totalPages} 页
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={page <= 1 || isFetching}
              onClick={() => setPage((current) => current - 1)}
            >
              上一页
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={page >= totalPages || isFetching}
              onClick={() => setPage((current) => current + 1)}
            >
              下一页
            </Button>
          </div>
        </div>
      )}

      <Dialog
        open={!!reviewTarget}
        onOpenChange={(open) => {
          if (!open && !reviewMutation.isPending) setReviewTarget(undefined);
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {reviewDecision === "APPROVE" ? "批准申请并生成密钥" : "拒绝申请"}
            </DialogTitle>
            <DialogDescription className="sr-only">
              审核无合同密钥生成申请。
            </DialogDescription>
          </DialogHeader>

          {reviewTarget && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-y py-4 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">申请编号</p>
                  <p className="mt-1 font-mono font-medium">
                    {reviewTarget.requestNo}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">申请人</p>
                  <p className="mt-1 font-medium">
                    {reviewTarget.requestedByName}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">数量 / 有效期</p>
                  <p className="mt-1 font-medium">
                    {reviewTarget.count} 个 / {reviewTarget.days} 天
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">传感器</p>
                  <p
                    className="mt-1 truncate font-medium"
                    title={formatSensors(reviewTarget.sensorTypes)}
                  >
                    {formatSensors(reviewTarget.sensorTypes)}
                  </p>
                </div>
              </div>

              <div>
                <p className="text-xs text-muted-foreground">申请原因</p>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm">
                  {reviewTarget.reason}
                </p>
              </div>

              {reviewTarget.generationRemark && (
                <div>
                  <p className="text-xs text-muted-foreground">生成备注</p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm">
                    {reviewTarget.generationRemark}
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="generation-review-remark">
                  {reviewDecision === "APPROVE"
                    ? "审批意见（可选）"
                    : "拒绝原因"}
                </Label>
                <Textarea
                  id="generation-review-remark"
                  value={reviewRemark}
                  onChange={(event) => setReviewRemark(event.target.value)}
                  rows={4}
                  maxLength={1000}
                  className="resize-none"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={reviewMutation.isPending}
              onClick={() => setReviewTarget(undefined)}
            >
              取消
            </Button>
            <Button
              type="button"
              variant={reviewDecision === "REJECT" ? "destructive" : "default"}
              disabled={
                reviewMutation.isPending ||
                (reviewDecision === "REJECT" && !reviewRemark.trim())
              }
              onClick={submitReview}
            >
              <ButtonSpinner pending={reviewMutation.isPending} />
              <span>
                {reviewDecision === "APPROVE" ? "批准并生成" : "确认拒绝"}
              </span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
