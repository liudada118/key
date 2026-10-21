import { useId } from "react";
import { Label } from "@/components/ui/label";
import { LICENSE_PRODUCT_LABELS, LICENSE_PRODUCT_TYPES, type LicenseProductType } from "@shared/licenseProducts";

/** Product selection is separate from device-count, scope and validity controls. */
export default function LicenseProductSelect({ value, onChange }: { value: LicenseProductType; onChange: (value: LicenseProductType) => void }) {
  const id = useId();
  return <div className="space-y-1.5">
    <Label htmlFor={id}>授权产品</Label>
    <select id={id} value={value} onChange={event => onChange(event.target.value as LicenseProductType)}
      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-describedby={`${id}-hint`}>
      {LICENSE_PRODUCT_TYPES.map(product => <option key={product} value={product}>{LICENSE_PRODUCT_LABELS[product]}</option>)}
    </select>
    <p id={`${id}-hint`} className="text-sm text-muted-foreground">上位机与 SDK 密钥分别授权。SDK 不限制设备型号，包含通用串口访问；有效期与电脑数量仍按密钥设置。</p>
  </div>;
}

export function SdkDevicePolicyNotice() {
  return <div className="rounded-md border bg-muted/30 p-4 text-sm space-y-2">
    <p className="font-medium">SDK 不限制设备型号</p>
    <p className="text-muted-foreground">包含产品连接、通用串口、实时转发与录制能力。新接入的设备无需增加型号授权；协议解析能力以 SDK 实际支持为准。</p>
    <p className="text-muted-foreground">密钥仍限 SDK 产品使用，有效期和电脑数量设置继续生效。</p>
  </div>;
}
