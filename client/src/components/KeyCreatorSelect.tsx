import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { RefreshCw } from "lucide-react";
import type { LicenseDeviceMode } from "@/lib/licenseDeviceMode";

/** Share the permission-scoped creator menu across ordinary and computer-limited key lists. */
export default function KeyCreatorSelect({ keyType, deviceMode, value, onChange }: {
  keyType: "online" | "offline";
  deviceMode: LicenseDeviceMode;
  value: string;
  onChange: (value: string) => void;
}) {
  const { data, isLoading, isError, refetch } = trpc.keys.creators.useQuery({ keyType, deviceMode });
  return <div className="flex min-w-0 max-w-full items-center gap-2">
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label="按生成人员筛选" className="w-[200px] max-w-full bg-secondary/50">
        <SelectValue placeholder="全部人员" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__all__">全部人员</SelectItem>
        {data?.map(person => <SelectItem key={person.id} value={String(person.id)}>
          {person.name}{person.username ? ` (${person.username})` : ` (#${person.id})`}
        </SelectItem>)}
        {isLoading && <SelectItem value="__loading__" disabled>正在加载人员…</SelectItem>}
        {isError && <SelectItem value="__error__" disabled>人员加载失败</SelectItem>}
      </SelectContent>
    </Select>
    {isError && <Tooltip><TooltipTrigger asChild>
      <Button variant="ghost" size="icon" aria-label="重新加载生成人员" onClick={() => void refetch()}>
        <RefreshCw className="h-4 w-4" />
      </Button>
    </TooltipTrigger><TooltipContent>重新加载生成人员</TooltipContent></Tooltip>}
  </div>;
}
