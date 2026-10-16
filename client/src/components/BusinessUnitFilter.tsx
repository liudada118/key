import React, { useId } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";

export function BusinessUnitFilter({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const id = useId();
  const { data = [], isLoading, isFetching, error, refetch } = trpc.contracts.businessUnits.useQuery();
  return (
    <div className="w-full min-w-0 space-y-2 sm:w-48">
      <Label htmlFor={id}>事业部</Label>
      <select id={id} value={value} disabled={isLoading} aria-busy={isFetching}
        aria-describedby={error ? `${id}-error` : undefined}
        className="border-input bg-background h-11 w-full min-w-0 rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:opacity-50"
        onChange={event => onChange(event.target.value)}>
        <option value="">全部</option>
        {value && !data.includes(value) && <option value={value}>{value}</option>}
        {data.map(name => <option key={name} value={name}>{name}</option>)}
      </select>
      {error && (
        <div id={`${id}-error`} role="alert" className="flex items-center gap-2 text-xs text-destructive">
          <span>事业部选项读取失败</span>
          <Button variant="ghost" size="icon" disabled={isFetching} title="重新读取事业部选项"
            aria-label="重新读取事业部选项" onClick={() => refetch()}>
            <RefreshCw key="icon" aria-hidden="true" className={`h-4 w-4 ${isFetching ? "animate-spin motion-reduce:animate-none" : ""}`} />
          </Button>
        </div>
      )}
    </div>
  );
}
