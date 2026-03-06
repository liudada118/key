import { useAuth } from "@/_core/hooks/useAuth";
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
import { Loader2, Pencil, Plus, ShieldCheck, Users } from "lucide-react";
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
  const { data: accounts, isLoading } = trpc.accounts.list.useQuery();
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<{
    id: number;
    name: string | null;
    isActive: boolean;
    remark: string | null;
  } | null>(null);

  // Create form state
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState<"admin" | "user">("user");
  const [newRemark, setNewRemark] = useState("");

  // Edit form state
  const [editName, setEditName] = useState("");
  const [editActive, setEditActive] = useState(true);
  const [editRemark, setEditRemark] = useState("");

  const createMutation = trpc.accounts.create.useMutation({
    onSuccess: () => {
      toast.success("账号创建成功");
      setCreateOpen(false);
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

  const handleCreate = () => {
    if (!newName.trim()) return toast.error("请输入账号名称");
    createMutation.mutate({
      name: newName.trim(),
      role: newRole,
      remark: newRemark || undefined,
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

  const openEdit = (account: {
    id: number;
    name: string | null;
    isActive: boolean;
    remark: string | null;
  }) => {
    setEditTarget(account);
    setEditName(account.name || "");
    setEditActive(account.isActive);
    setEditRemark(account.remark || "");
    setEditOpen(true);
  };

  const canCreateAdmin = user?.role === "super_admin";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">账号管理</h1>
          <p className="text-muted-foreground mt-1">
            {user?.role === "super_admin"
              ? "管理所有管理员和子账号"
              : "管理您创建的子账号"}
          </p>
        </div>
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
                <Label className="text-foreground">账号名称</Label>
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="输入账号名称"
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
                <Label className="text-foreground">备注（可选）</Label>
                <Textarea
                  value={newRemark}
                  onChange={(e) => setNewRemark(e.target.value)}
                  placeholder="输入备注"
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
      </div>

      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-base font-medium flex items-center gap-2 text-foreground">
            <Users className="h-4 w-4 text-primary" />
            账号列表
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
                    <TableHead className="text-muted-foreground">名称</TableHead>
                    <TableHead className="text-muted-foreground">角色</TableHead>
                    <TableHead className="text-muted-foreground">状态</TableHead>
                    <TableHead className="text-muted-foreground">备注</TableHead>
                    <TableHead className="text-muted-foreground">创建时间</TableHead>
                    <TableHead className="text-muted-foreground">最后登录</TableHead>
                    <TableHead className="text-muted-foreground w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {accounts.map((acc) => (
                    <TableRow key={acc.id} className="border-border/30">
                      <TableCell className="font-medium text-foreground">
                        {acc.name || "-"}
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
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          onClick={() => openEdit(acc)}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">编辑账号</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-foreground">账号名称</Label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
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
    </div>
  );
}
