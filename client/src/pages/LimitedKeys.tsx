import { useAuth } from "@/_core/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSearchParams } from "wouter";
import GenerateKey from "./GenerateKey";
import KeyList from "./KeyList";
import OfflineKeyGen from "./OfflineKeyGen";
import OfflineKeyList from "./OfflineKeyList";

/** Keep online/offline computer-limited licenses discoverable under a separate, permission-checked category. */
function LimitedKeys({ view }: { view: "generate" | "manage" }) {
  const { user } = useAuth();
  const [parameters, setParameters] = useSearchParams();
  const type = parameters.get("type") === "offline" ? "offline" : "online";
  if (user?.role !== "super_admin") return <p role="alert" className="rounded-lg border p-6 text-muted-foreground">仅超级管理员可以生成和管理限制电脑数量的密钥。</p>;
  return <div className="min-w-0 space-y-6">
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{view === "generate" ? "生成限制密钥" : "限制密钥管理"}</h1>
        <Badge variant="outline">需要新版客户端</Badge>
      </div>
      <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{view === "generate"
        ? "在这里生成按电脑数量授权的密钥。请选择在线或离线模式，再设置每把密钥可使用的电脑数。"
        : "这里集中管理需要电脑授权能力的密钥。调整数量、解绑或恢复电脑后，客户端在下一次授权校验时生效。"}</p>
      {view === "manage" && <p className="text-sm text-muted-foreground">离线限制码解除上限后仍保留在此分类，客户仍需使用新版客户端。</p>}
    </div>
    <Tabs value={type} onValueChange={value => setParameters(previous => { const next = new URLSearchParams(previous); next.set("type", value); return next; })} className="min-w-0 space-y-4">
      <TabsList aria-label="限制密钥模式" className="h-12 w-full max-w-sm">
        <TabsTrigger value="online" className="min-h-11">在线密钥</TabsTrigger>
        <TabsTrigger value="offline" className="min-h-11">离线密钥</TabsTrigger>
      </TabsList>
      <TabsContent value="online" className="min-w-0">{view === "generate" ? <GenerateKey deviceMode="limited" embedded /> : <KeyList deviceMode="limited" embedded />}</TabsContent>
      <TabsContent value="offline" className="min-w-0">{view === "generate" ? <OfflineKeyGen deviceMode="limited" embedded /> : <OfflineKeyList deviceMode="limited" embedded />}</TabsContent>
    </Tabs>
  </div>;
}

/** Route to the restricted generation workflow without duplicating either license form. */
export function LimitedKeyGeneration() { return <LimitedKeys view="generate" />; }
/** Route to categorized license records and the existing device management dialog. */
export function LimitedKeyManagement() { return <LimitedKeys view="manage" />; }
