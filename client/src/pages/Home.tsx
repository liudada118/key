import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { BarChart3, Building2, Key, KeyRound, ShieldAlert, ShieldCheck, Zap } from "lucide-react";

export default function Home() {
  const { user } = useAuth();
  const { data: stats, isLoading } = trpc.keys.stats.useQuery();

  const cards = [
    {
      title: "总密钥数",
      value: stats?.total ?? 0,
      icon: KeyRound,
      color: "text-chart-1",
      bg: "bg-chart-1/10",
    },
    {
      title: "已激活",
      value: stats?.activated ?? 0,
      icon: ShieldCheck,
      color: "text-chart-2",
      bg: "bg-chart-2/10",
    },
    {
      title: "量产密钥",
      value: stats?.production ?? 0,
      icon: Zap,
      color: "text-chart-3",
      bg: "bg-chart-3/10",
    },
    {
      title: "租赁密钥",
      value: stats?.rental ?? 0,
      icon: Key,
      color: "text-chart-4",
      bg: "bg-chart-4/10",
    },
    {
      title: "已过期",
      value: stats?.expired ?? 0,
      icon: ShieldAlert,
      color: "text-chart-5",
      bg: "bg-chart-5/10",
    },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          仪表盘
        </h1>
        <p className="text-muted-foreground mt-1">
          欢迎回来，{user?.name || "用户"}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {cards.map((card) => (
          <Card key={card.title} className="shadow-sm hover:shadow-md transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {card.title}
              </CardTitle>
              <div className={`h-8 w-8 rounded-lg ${card.bg} flex items-center justify-center`}>
                <card.icon className={`h-4 w-4 ${card.color}`} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-foreground">
                {isLoading ? (
                  <div className="h-9 w-16 bg-muted animate-pulse rounded" />
                ) : (
                  card.value.toLocaleString()
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-medium flex items-center gap-2 text-foreground">
              <BarChart3 className="h-4 w-4 text-primary" />
              密钥概览
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-4 bg-muted animate-pulse rounded" />
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                <StatBar label="已激活" value={stats?.activated ?? 0} total={stats?.total ?? 1} color="bg-chart-2" />
                <StatBar label="量产密钥" value={stats?.production ?? 0} total={stats?.total ?? 1} color="bg-chart-3" />
                <StatBar label="租赁密钥" value={stats?.rental ?? 0} total={stats?.total ?? 1} color="bg-chart-4" />
                <StatBar label="已过期" value={stats?.expired ?? 0} total={stats?.total ?? 1} color="bg-chart-5" />
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-medium flex items-center gap-2 text-foreground">
              <ShieldCheck className="h-4 w-4 text-primary" />
              快速操作
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              <QuickAction
                href="/generate"
                icon={KeyRound}
                label="生成密钥"
                desc="创建新的授权密钥"
              />
              <QuickAction
                href="/keys"
                icon={BarChart3}
                label="密钥管理"
                desc="查看和管理密钥"
              />
              <QuickAction
                href="/verify"
                icon={ShieldCheck}
                label="验证密钥"
                desc="解密验证密钥信息"
              />
              <QuickAction
                href="/customers"
                icon={Building2}
                label="客户管理"
                desc="管理客户信息"
              />
              <QuickAction
                href="/accounts"
                icon={Key}
                label="账号管理"
                desc="管理下级账号"
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatBar({
  label,
  value,
  total,
  color,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium text-foreground">
          {value} <span className="text-muted-foreground font-normal">({pct}%)</span>
        </span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full ${color} rounded-full transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function QuickAction({
  href,
  icon: Icon,
  label,
  desc,
}: {
  href: string;
  icon: React.ElementType;
  label: string;
  desc: string;
}) {
  return (
    <a
      href={href}
      className="flex flex-col gap-2 p-4 rounded-xl border border-border hover:bg-accent/50 hover:shadow-sm transition-all group"
    >
      <Icon className="h-5 w-5 text-primary group-hover:scale-110 transition-transform" />
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
    </a>
  );
}
