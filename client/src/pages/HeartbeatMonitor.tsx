import { useState } from "react";
import { trpc } from "../lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export default function HeartbeatMonitor() {
  const [hoursThreshold, setHoursThreshold] = useState(48);
  const [keyId, setKeyId] = useState<number | null>(null);

  const { data: lostDevices, refetch: refetchLost } = trpc.heartbeat.lost.useQuery({ hoursThreshold });
  const { data: keyHeartbeats } = trpc.heartbeat.list.useQuery(
    { keyId: keyId!, keyType: "online" },
    { enabled: !!keyId }
  );

  const getTimeSince = (date: Date | string) => {
    const diff = Date.now() - new Date(date).getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (hours < 1) return "刚刚";
    if (hours < 24) return `${hours} 小时前`;
    return `${Math.floor(hours / 24)} 天前`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">心跳监控</h1>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">超时阈值:</span>
          <Input
            type="number"
            className="w-20"
            value={hoursThreshold}
            onChange={(e) => setHoursThreshold(parseInt(e.target.value) || 48)}
          />
          <span className="text-sm text-muted-foreground">小时</span>
          <Button variant="outline" onClick={() => refetchLost()}>刷新</Button>
        </div>
      </div>

      {/* 说明 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">心跳机制说明</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          <p>客户端软件需定期调用心跳接口（建议间隔 4-12 小时），服务端会验证密钥状态并记录设备在线情况。</p>
          <p>如果设备超过设定阈值未发送心跳，将被标记为"心跳丢失"，可能表示设备离线或密钥被非法使用。</p>
          <p>心跳接口同时返回密钥状态，如果密钥已被暂停/吊销/过期，客户端应立即停止服务。</p>
        </CardContent>
      </Card>

      {/* 心跳丢失设备 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-red-600">心跳丢失设备（超过 {hoursThreshold} 小时未心跳）</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>密钥 ID</TableHead>
                <TableHead>设备码</TableHead>
                <TableHead>最后心跳</TableHead>
                <TableHead>累计心跳次数</TableHead>
                <TableHead>客户端 IP</TableHead>
                <TableHead>客户端版本</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lostDevices?.map((device) => (
                <TableRow key={device.id} className="bg-red-50">
                  <TableCell>
                    <Button variant="link" size="sm" className="p-0" onClick={() => setKeyId(device.keyId)}>
                      #{device.keyId}
                    </Button>
                  </TableCell>
                  <TableCell className="font-mono text-sm">{device.deviceCode}</TableCell>
                  <TableCell>
                    <Badge variant="destructive">{getTimeSince(device.lastHeartbeatAt)}</Badge>
                  </TableCell>
                  <TableCell>{device.heartbeatCount}</TableCell>
                  <TableCell className="text-sm">{device.clientIp || "-"}</TableCell>
                  <TableCell className="text-sm">{device.clientVersion || "-"}</TableCell>
                  <TableCell>
                    <Button size="sm" variant="outline" onClick={() => setKeyId(device.keyId)}>查看详情</Button>
                  </TableCell>
                </TableRow>
              ))}
              {(!lostDevices || lostDevices.length === 0) && (
                <TableRow><TableCell colSpan={7} className="text-center text-green-600 py-8">所有设备心跳正常</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* 密钥心跳详情 */}
      {keyId && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>密钥 #{keyId} 的心跳记录</CardTitle>
              <Button size="sm" variant="ghost" onClick={() => setKeyId(null)}>关闭</Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>设备码</TableHead>
                  <TableHead>最后心跳</TableHead>
                  <TableHead>心跳次数</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>版本</TableHead>
                  <TableHead>首次记录</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keyHeartbeats?.map((hb) => (
                  <TableRow key={hb.id}>
                    <TableCell className="font-mono text-sm">{hb.deviceCode}</TableCell>
                    <TableCell>{getTimeSince(hb.lastHeartbeatAt)}</TableCell>
                    <TableCell>{hb.heartbeatCount}</TableCell>
                    <TableCell className="text-sm">{hb.clientIp || "-"}</TableCell>
                    <TableCell className="text-sm">{hb.clientVersion || "-"}</TableCell>
                    <TableCell className="text-sm">{new Date(hb.createdAt).toLocaleString("zh-CN")}</TableCell>
                  </TableRow>
                ))}
                {(!keyHeartbeats || keyHeartbeats.length === 0) && (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-4">暂无心跳记录</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
