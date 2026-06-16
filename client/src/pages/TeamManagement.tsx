import { useState } from "react";
import { trpc } from "../lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export default function TeamManagement() {
  
  const [showCreate, setShowCreate] = useState(false);
  const [showMembers, setShowMembers] = useState<number | null>(null);
  const [form, setForm] = useState({ name: "", description: "", leaderName: "" });

  const { data: teams, refetch } = trpc.teams.list.useQuery();
  const { data: members } = trpc.teams.members.useQuery(
    { teamId: showMembers! },
    { enabled: !!showMembers }
  );

  const createMutation = trpc.teams.create.useMutation({
    onSuccess: () => {
      toast.success("团队创建成功");
      setShowCreate(false);
      setForm({ name: "", description: "", leaderName: "" });
      refetch();
    },
    onError: (err) => toast.error("创建失败"),
  });

  const updateMutation = trpc.teams.update.useMutation({
    onSuccess: () => {
      toast.success("更新成功");
      refetch();
    },
    onError: (err) => toast.error("更新失败"),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">团队管理</h1>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button>新建团队</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>新建团队</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">团队名称 *</label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如 华东销售组" />
              </div>
              <div>
                <label className="text-sm font-medium">团队描述</label>
                <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="团队描述" />
              </div>
              <div>
                <label className="text-sm font-medium">负责人名称</label>
                <Input value={form.leaderName} onChange={(e) => setForm({ ...form, leaderName: e.target.value })} placeholder="负责人名称" />
              </div>
              <Button
                className="w-full"
                onClick={() => createMutation.mutate({ name: form.name, description: form.description || undefined, leaderName: form.leaderName || undefined })}
                disabled={!form.name || createMutation.isPending}
              >
                {createMutation.isPending ? "创建中..." : "创建团队"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* 团队列表 */}
      <Card>
        <CardHeader>
          <CardTitle>团队列表</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>团队名称</TableHead>
                <TableHead>描述</TableHead>
                <TableHead>负责人</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {teams?.map((team) => (
                <TableRow key={team.id}>
                  <TableCell>{team.id}</TableCell>
                  <TableCell className="font-medium">{team.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{team.description || "-"}</TableCell>
                  <TableCell>{team.leaderName || "-"}</TableCell>
                  <TableCell>
                    <Badge variant={team.isActive ? "default" : "secondary"}>
                      {team.isActive ? "启用" : "禁用"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{new Date(team.createdAt).toLocaleDateString("zh-CN")}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => setShowMembers(team.id)}>成员</Button>
                      <Button
                        size="sm"
                        variant={team.isActive ? "destructive" : "default"}
                        onClick={() => updateMutation.mutate({ id: team.id, isActive: !team.isActive })}
                      >
                        {team.isActive ? "禁用" : "启用"}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {(!teams || teams.length === 0) && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">暂无团队</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* 成员弹窗 */}
      <Dialog open={!!showMembers} onOpenChange={() => setShowMembers(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>团队成员</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {members?.map((member) => (
              <div key={member.id} className="flex items-center justify-between p-2 border rounded">
                <div>
                  <span className="font-medium">{member.name || member.username}</span>
                  <Badge className="ml-2" variant="outline">{member.role}</Badge>
                </div>
                <Badge variant={member.isActive ? "default" : "secondary"}>
                  {member.isActive ? "启用" : "禁用"}
                </Badge>
              </div>
            ))}
            {(!members || members.length === 0) && (
              <p className="text-center text-muted-foreground py-4">暂无成员</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
