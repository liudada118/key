import { useAuth } from "@/_core/hooks/useAuth";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Switch } from "@/components/ui/switch";
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
import { KeyRound, Loader2, Pencil, Plus, ShieldCheck, Trash2, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const ROLE_LABELS: Record<string, string> = {
  super_admin: "超级管理员",
  admin: "管理员",
  user: "子账号",
};

const ROLE_COLORS: Record<string, string> = {
  super_admin: "bg-chart-1/10 text-chart-1 border-chart-1/30",
  admin: "bg-chart-2/10 text-chart-2 border-chart-2/30",
  user: "bg-chart-3/10 text-chart-3 border-chart-3/30",
};

export default function AccountManagement() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const { data, isLoading } = trpc.accounts.list.useQuery({ page, pageSize });
  const accounts = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / pageSize);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [resetPwdOpen, setResetPwdOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<{
    id: number;
    name: string | null;
    username: string;
    isActive: boolean;
    remark: string | null;
  } | null>(null);
  const [resetTarget, setResetTarget] = useState<{
    id: number;
    name: string | null;
    username: string;
  } | null>(null);

  // Create form state
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState<"admin" | "user">("user");
  const [newRemark, setNewRemark] = useState("");
  const [newDeptId, setNewDeptId] = useState<string>("");
  const { data: departments } = trpc.departments.list.useQuery();
  const selectedDept = (departments as any[] | undefined)?.find((d) => String(d.id) === newDeptId);

  // Edit form state
  const [editName, setEditName] = useState("");
  const [editActive, setEditActive] = useState(true);
  const [editRemark, setEditRemark] = useState("");

  // Reset password state
  const [resetNewPwd, setResetNewPwd] = useState("");

  // 个人账号：改密码 / 改资料
  const [selfPwdOpen, setSelfPwdOpen] = useState(false);
  const [oldPwd, setOldPwd] = useState("");
  const [selfNewPwd, setSelfNewPwd] = useState("");
  const [selfInfoOpen, setSelfInfoOpen] = useState(false);
  const [selfName, setSelfName] = useState("");
  const [selfRemark, setSelfRemark] = useState("");
  const ownDept = (departments as any[] | undefined)?.find(
    (d) => d.id === (user as any)?.departmentId,
  );

  const createMutation = trpc.accounts.create.useMutation({
    onSuccess: () => {
      toast.success("账号创建成功");
      setCreateOpen(false);
      setNewUsername("");
      setNewPassword("");
      setNewName("");
      setNewRemark("");
      utils.accounts.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const updateMutation = trpc.accounts.update.useMutation({
    onSuccess: () => {
      toast.success("账号更新成功");
      setEditOpen(false);
      setEditTarget(null);
      utils.accounts.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const resetPwdMutation = trpc.accounts.resetPassword.useMutation({
    onSuccess: () => {
      toast.success("密码重置成功");
      setResetPwdOpen(false);
      setResetTarget(null);
      setResetNewPwd("");
    },
    onError: (err) => toast.error(err.message),
  });

  const changePwdMutation = trpc.auth.changePassword.useMutation({
    onSuccess: () => {
      toast.success("密码修改成功");
      setSelfPwdOpen(false);
      setOldPwd("");
      setSelfNewPwd("");
    },
    onError: (err) => toast.error(err.message),
  });

  const updateSelfMutation = trpc.accounts.updateSelf.useMutation({
    onSuccess: () => {
      toast.success("已保存");
      setSelfInfoOpen(false);
      utils.auth.me.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const [deleteTarget, setDeleteTarget] = useState<{ id: number; username: string; name: string | null } | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const deleteMutation = trpc.accounts.delete.useMutation({
    onSuccess: () => {
      toast.success("账号已删除");
      setDeleteOpen(false);
      utils.accounts.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const handleCreate = () => {
    if (!newUsername.trim()) return toast.error("请输入用户名");
    if (!newPassword.trim()) return toast.error("请输入密码");
    if (newPassword.length < 6) return toast.error("密码至少6位");
    if (!newName.trim()) return toast.error("请输入显示名称");
    createMutation.mutate({
      username: newUsername.trim(),
      password: newPassword,
      name: newName.trim(),
      role: newRole,
      remark: newRemark || undefined,
      departmentId: newDeptId ? Number(newDeptId) : undefined,
    });
  };

  const handleEdit = () => {
    if (!editTarget) return;
    updateMutation.mutate({
      id: editTarget.id,
      name: editName.trim() || undefined,
      isActive: editActive,
      remark: editRemark || undefined,
    });
  };

  const handleResetPwd = () => {
    if (!resetTarget) return;
    if (!resetNewPwd.trim() || resetNewPwd.length < 6) {
      return toast.error("新密码至少6位");
    }
    resetPwdMutation.mutate({
      id: resetTarget.id,
      newPassword: resetNewPwd,
    });
  };

  const handleChangePwd = () => {
    if (!oldPwd.trim()) return toast.error("请输入旧密码");
    if (!selfNewPwd.trim() || selfNewPwd.length < 6) return toast.error("新密码至少6位");
    changePwdMutation.mutate({ oldPassword: oldPwd, newPassword: selfNewPwd });
  };

  const openSelfInfo = () => {
    setSelfName(user?.name || "");
    setSelfRemark((user as any)?.remark || "");
    setSelfInfoOpen(true);
  };

  const handleSelfInfo = () => {
    updateSelfMutation.mutate({
      name: selfName.trim() || undefined,
      remark: selfRemark,
    });
  };

  const openEdit = (account: {
    id: number;
    name: string | null;
    username: string;
    isActive: boolean;
    remark: string | null;
  }) => {
    setEditTarget(account);
    setEditName(account.name || "");
    setEditActive(account.isActive);
    setEditRemark(account.remark || "");
    setEditOpen(true);
  };

  const openResetPwd = (account: {
    id: number;
    name: string | null;
    username: string;
  }) => {
    setResetTarget(account);
    setResetNewPwd("");
    setResetPwdOpen(true);
  };

  const canCreateAdmin = user?.role === "super_admin";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">账号管理</h1>
          <p className="text-muted-foreground mt-1">
            {user?.role === "super_admin"
              ? "管理个人账号、管理员与子账号"
              : user?.role === "admin"
                ? "管理个人账号与本部门子账号"
                : "查看并管理个人账号"}
          </p>
        </div>
        {user?.role !== "user" && (
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              创建账号
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border">
            <DialogHeader>
              <DialogTitle className="text-foreground">创建新账号</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label className="text-foreground">用户名（登录用）</Label>
                <Input
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="输入用户名"
                  className="bg-secondary/50"
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-foreground">密码</Label>
                <Input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="至少6位"
                  className="bg-secondary/50"
                  autoComplete="new-password"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-foreground">显示名称</Label>
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="输入显示名称"
                  maxLength={30}
                  className="bg-secondary/50"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-foreground">角色</Label>
                <Select
                  value={newRole}
                  onValueChange={(v) => setNewRole(v as "admin" | "user")}
                >
                  <SelectTrigger className="bg-secondary/50">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {canCreateAdmin && (
                      <SelectItem value="admin">管理员</SelectItem>
                    )}
                    <SelectItem value="user">子账号</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-foreground">部门</Label>
                {user?.role === "super_admin" ? (
                  <>
                    <Select value={newDeptId} onValueChange={setNewDeptId}>
                      <SelectTrigger className="bg-secondary/50">
                        <SelectValue placeholder="选择部门（决定归属与传感器分组）" />
                      </SelectTrigger>
                      <SelectContent>
                        {((departments as any[]) || []).map((d) => (
                          <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {selectedDept && (
                      <p className="text-xs text-muted-foreground">对应传感器类型：{selectedDept.sensorGroup || "无（不绑定分组）"}</p>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground bg-secondary/30 rounded-md px-3 py-2">
                    {ownDept ? `本部门：${ownDept.name}` : "未归属部门（子账号将不绑定部门）"}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label className="text-foreground">备注（可选）</Label>
                <Textarea
                  value={newRemark}
                  onChange={(e) => setNewRemark(e.target.value)}
                  placeholder="输入备注"
                  maxLength={200}
                  className="bg-secondary/50 resize-none"
                  rows={2}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>
                取消
              </Button>
              <Button onClick={handleCreate} disabled={createMutation.isPending}>
                {createMutation.isPending && (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                )}
                创建
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        )}
      </div>

      {/* 个人账号 */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-base font-medium flex items-center gap-2 text-foreground">
            <ShieldCheck className="h-4 w-4 text-primary" />
            个人账号
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
            <div>
              <p className="text-xs text-muted-foreground">用户名</p>
              <p className="font-mono text-sm text-foreground">{user?.username}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">名称</p>
              <p className="text-sm text-foreground">{user?.name || "-"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">角色</p>
              <Badge variant="outline" className={ROLE_COLORS[user?.role || ""] || ""}>
                {ROLE_LABELS[user?.role || ""] || user?.role}
              </Badge>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">所属部门</p>
              <p className="text-sm text-foreground">{ownDept?.name || "-"}</p>
            </div>
            <div className="min-w-[120px]">
              <p className="text-xs text-muted-foreground">备注</p>
              <p className="text-sm text-foreground truncate max-w-[240px]">{(user as any)?.remark || "-"}</p>
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <Button variant="outline" size="sm" onClick={openSelfInfo}>
                <Pencil className="h-3.5 w-3.5 mr-1.5" />
                编辑资料
              </Button>
              <Button variant="outline" size="sm" onClick={() => { setOldPwd(""); setSelfNewPwd(""); setSelfPwdOpen(true); }}>
                <KeyRound className="h-3.5 w-3.5 mr-1.5" />
                修改密码
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {user?.role !== "user" && (
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-base font-medium flex items-center gap-2 text-foreground">
            <Users className="h-4 w-4 text-primary" />
            下属账号
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : !accounts?.length ? (
            <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
              <Users className="h-12 w-12 mb-3 opacity-20" />
              <p className="text-sm">暂无下级账号</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border/50">
                    <TableHead className="text-muted-foreground">用户名</TableHead>
                    <TableHead className="text-muted-foreground">名称</TableHead>
                    <TableHead className="text-muted-foreground">对应部门</TableHead>
                    <TableHead className="text-muted-foreground">角色</TableHead>
                    <TableHead className="text-muted-foreground">状态</TableHead>
                    <TableHead className="text-muted-foreground">备注</TableHead>
                    <TableHead className="text-muted-foreground">创建时间</TableHead>
                    <TableHead className="text-muted-foreground">最后登录</TableHead>
                    <TableHead className="text-muted-foreground w-24">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {accounts.map((acc) => (
                    <TableRow key={acc.id} className="border-border/30">
                      <TableCell className="font-mono text-sm text-foreground">
                        {acc.username}
                      </TableCell>
                      <TableCell className="font-medium text-foreground">
                        {acc.name || "-"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {(acc as any).deptName || "-"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={ROLE_COLORS[acc.role] || ""}
                        >
                          {ROLE_LABELS[acc.role] || acc.role}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {acc.isActive ? (
                          <Badge variant="outline" className="bg-chart-2/10 text-chart-2 border-chart-2/30">
                            <ShieldCheck className="h-3 w-3 mr-1" />
                            启用
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">
                            禁用
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                        {acc.remark || "-"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(acc.createdAt).toLocaleDateString("zh-CN")}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(acc.lastSignedIn).toLocaleDateString("zh-CN")}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            onClick={() => openEdit(acc)}
                            title="编辑"
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            onClick={() => openResetPwd(acc)}
                            title="重置密码"
                          >
                            <KeyRound className="h-3 w-3" />
                          </Button>
                          {acc.id !== user?.id && acc.role !== "super_admin" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                              onClick={() => { setDeleteTarget(acc); setDeleteOpen(true); }}
                              disabled={deleteMutation.isPending}
                              title="删除"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-muted-foreground">共 {total} 个账号，第 {page}/{totalPages} 页</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>下一页</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      )}

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              编辑账号 - {editTarget?.username}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-foreground">显示名称</Label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="输入名称"
                maxLength={30}
                className="bg-secondary/50"
              />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-foreground">启用状态</Label>
              <Switch checked={editActive} onCheckedChange={setEditActive} />
            </div>
            <div className="space-y-2">
              <Label className="text-foreground">备注</Label>
              <Textarea
                value={editRemark}
                onChange={(e) => setEditRemark(e.target.value)}
                placeholder="输入备注"
                maxLength={200}
                className="bg-secondary/50 resize-none"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              取消
            </Button>
            <Button onClick={handleEdit} disabled={updateMutation.isPending}>
              {updateMutation.isPending && (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              )}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={resetPwdOpen} onOpenChange={setResetPwdOpen}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              重置密码 - {resetTarget?.name || resetTarget?.username}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              为用户 <span className="font-mono text-foreground">{resetTarget?.username}</span> 设置新密码
            </p>
            <div className="space-y-2">
              <Label className="text-foreground">新密码</Label>
              <Input
                type="password"
                value={resetNewPwd}
                onChange={(e) => setResetNewPwd(e.target.value)}
                placeholder="至少6位"
                className="bg-secondary/50"
                autoComplete="new-password"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetPwdOpen(false)}>
              取消
            </Button>
            <Button onClick={handleResetPwd} disabled={resetPwdMutation.isPending}>
              {resetPwdMutation.isPending && (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              )}
              确认重置
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认弹窗 */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle>删除账号</AlertDialogTitle>
            <AlertDialogDescription>
              确定删除账号「{deleteTarget?.name || deleteTarget?.username}」吗？此操作不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate({ id: deleteTarget.id })}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 个人 - 修改密码 */}
      <Dialog open={selfPwdOpen} onOpenChange={setSelfPwdOpen}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">修改密码</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-foreground">旧密码</Label>
              <Input
                type="password"
                value={oldPwd}
                onChange={(e) => setOldPwd(e.target.value)}
                placeholder="输入当前密码"
                className="bg-secondary/50"
                autoComplete="current-password"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-foreground">新密码</Label>
              <Input
                type="password"
                value={selfNewPwd}
                onChange={(e) => setSelfNewPwd(e.target.value)}
                placeholder="至少6位"
                className="bg-secondary/50"
                autoComplete="new-password"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelfPwdOpen(false)}>取消</Button>
            <Button onClick={handleChangePwd} disabled={changePwdMutation.isPending}>
              {changePwdMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              确认修改
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 个人 - 编辑资料 */}
      <Dialog open={selfInfoOpen} onOpenChange={setSelfInfoOpen}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">编辑个人资料</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-foreground">显示名称</Label>
              <Input
                value={selfName}
                onChange={(e) => setSelfName(e.target.value)}
                placeholder="输入名称"
                maxLength={30}
                className="bg-secondary/50"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-foreground">备注</Label>
              <Textarea
                value={selfRemark}
                onChange={(e) => setSelfRemark(e.target.value)}
                placeholder="输入备注"
                maxLength={200}
                className="bg-secondary/50 resize-none"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelfInfoOpen(false)}>取消</Button>
            <Button onClick={handleSelfInfo} disabled={updateSelfMutation.isPending}>
              {updateSelfMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
