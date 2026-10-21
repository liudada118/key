import React, { useId } from "react";
import { AlertTriangle } from "lucide-react";
import { Button, ButtonSpinner } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type PasswordResetTarget = {
  id: number;
  name: string | null;
  username: string;
  isActive: boolean;
};

export function passwordResetSuccessMessage(isActive?: boolean) {
  return isActive === false
    ? "密码重置成功，账号仍被禁用，请在编辑账号中启用后登录"
    : "密码重置成功";
}

export default function AccountPasswordResetDialog({ open, target, password, pending, onOpenChange, onPasswordChange, onSubmit }: {
  open: boolean;
  target: PasswordResetTarget | null;
  password: string;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onPasswordChange: (password: string) => void;
  onSubmit: () => void;
}) {
  const id = useId();
  const disabledAccount = target?.isActive === false;
  const canSubmit = !!target && !!password.trim() && password.length >= 6 && !pending;
  return (
    <Dialog open={open} onOpenChange={next => { if (!pending) onOpenChange(next); }}>
      <DialogContent className="bg-card border-border" showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>重置密码 - {target?.name || target?.username}</DialogTitle>
          <DialogDescription>
            为用户 <span className="font-mono text-foreground">{target?.username}</span> 设置新密码
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={event => { event.preventDefault(); if (canSubmit) onSubmit(); }}>
          <div className="space-y-4 py-2">
            {disabledAccount && (
              <div id={`${id}-status`} role="status" className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <p>该账号已禁用。重置密码不会自动启用账号，需在编辑账号中开启“启用状态”后才能登录。</p>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor={`${id}-password`}>新密码</Label>
              <Input id={`${id}-password`} type="password" value={password}
                onChange={event => onPasswordChange(event.target.value)} placeholder="至少6位"
                className="bg-secondary/50" autoComplete="new-password" disabled={pending}
                aria-describedby={disabledAccount ? `${id}-status` : undefined} />
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="submit" disabled={!canSubmit}>
              <ButtonSpinner pending={pending} />
              <span>确认重置</span>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
