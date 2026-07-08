import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { Building2, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const NONE = "__none__";

export default function DepartmentManagement() {
  const utils = trpc.useUtils();
  const { data: departments, isLoading } = trpc.departments.list.useQuery();
  const { data: groups } = trpc.sensors.groupNames.useQuery();
  const { data: allUsers } = trpc.accounts.all.useQuery();

  // 可作为部门管理员的账号（管理员 / 超管）
  const managerCandidates = ((allUsers as any[] | undefined) ?? []).filter(
    (u) => u.role === "admin" || u.role === "super_admin",
  );

  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [sensorGroup, setSensorGroup] = useState<string>(NONE);
  const [managerId, setManagerId] = useState<string>(NONE);

  const resetForm = () => {
    setEditId(null);
    setName("");
    setSensorGroup(NONE);
    setManagerId(NONE);
  };

  const openCreate = () => {
    resetForm();
    setOpen(true);
  };

  const openEdit = (d: any) => {
    setEditId(d.id);
    setName(d.name);
    setSensorGroup(d.sensorGroup || NONE);
    setManagerId(d.managerId ? String(d.managerId) : NONE);
    setOpen(true);
  };

  const createMutation = trpc.departments.create.useMutation({
    onSuccess: () => {
      toast.success("部门已创建");
      setOpen(false);
      resetForm();
      utils.departments.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const updateMutation = trpc.departments.update.useMutation({
    onSuccess: () => {
      toast.success("部门已更新");
      setOpen(false);
      resetForm();
      utils.departments.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = trpc.departments.delete.useMutation({
    onSuccess: () => {
      toast.success("部门已删除");
      utils.departments.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const handleSubmit = () => {
    if (!name.trim()) {
      toast.error("请填写部门名称");
      return;
    }
    const payload = {
      name: name.trim(),
      sensorGroup: sensorGroup === NONE ? null : sensorGroup,
      managerId: managerId === NONE ? null : Number(managerId),
    };
    if (editId) {
      updateMutation.mutate({ id: editId, ...payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const saving = createMutation.isPending || updateMutation.isPending;
  const groupNames = ((groups as any[] | undefined) ?? []).map((g) => g.groupName);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            部门管理
          </h1>
          <p className="text-muted-foreground mt-1">
            管理部门与传感器分组的对应关系，指定部门管理员（决定密钥的跨部门可见范围）
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1.5" />
          新增部门
        </Button>
      </div>

      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-base">部门列表</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : !departments || departments.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
              <Building2 className="h-12 w-12 mb-3 opacity-20" />
              <p className="text-sm">暂无部门</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border/50">
                    <TableHead className="text-muted-foreground w-16">ID</TableHead>
                    <TableHead className="text-muted-foreground">部门名称</TableHead>
                    <TableHead className="text-muted-foreground">对应传感器分组</TableHead>
                    <TableHead className="text-muted-foreground">部门管理员</TableHead>
                    <TableHead className="text-muted-foreground">账号数</TableHead>
                    <TableHead className="text-muted-foreground w-24">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(departments as any[]).map((d) => (
                    <TableRow key={d.id} className="border-border/30">
                      <TableCell className="text-sm text-muted-foreground">{d.id}</TableCell>
                      <TableCell className="text-sm font-medium text-foreground">{d.name}</TableCell>
                      <TableCell className="text-sm">
                        {d.sensorGroup ? (
                          <Badge variant="secondary" className="text-xs">{d.sensorGroup}</Badge>
                        ) : (
                          <span className="text-muted-foreground">无（不绑定分组）</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-foreground">{d.managerName || "-"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{d.memberCount}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            onClick={() => openEdit(d)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                            onClick={() => {
                              if (confirm(`确定要删除部门「${d.name}」吗？`)) {
                                deleteMutation.mutate({ id: d.id });
                              }
                            }}
                            disabled={deleteMutation.isPending}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 新增 / 编辑弹窗 */}
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) resetForm(); }}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{editId ? "编辑部门" : "新增部门"}</DialogTitle>
            <DialogDescription>
              部门绑定的传感器分组，决定该部门管理员能跨部门看到哪些密钥
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>部门名称 <span className="text-destructive">*</span></Label>
              <Input
                placeholder="例如：关怀事业部"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>对应传感器分组</Label>
              <Select value={sensorGroup} onValueChange={setSensorGroup}>
                <SelectTrigger>
                  <SelectValue placeholder="选择传感器分组" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>无（不绑定分组）</SelectItem>
                  {groupNames.map((g: string) => (
                    <SelectItem key={g} value={g}>{g}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>部门管理员</Label>
              <Select value={managerId} onValueChange={setManagerId}>
                <SelectTrigger>
                  <SelectValue placeholder="选择部门管理员" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>暂不指定</SelectItem>
                  {managerCandidates.map((u) => (
                    <SelectItem key={u.id} value={String(u.id)}>
                      {u.name || u.username}（{u.role === "super_admin" ? "超管" : "管理员"}）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(false); resetForm(); }}>
              取消
            </Button>
            <Button onClick={handleSubmit} disabled={saving || !name.trim()}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {editId ? "保存" : "创建"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
