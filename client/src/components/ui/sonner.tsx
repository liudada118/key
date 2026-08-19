import { cn } from "@/lib/utils";
import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";

function protectToasterNode(node: HTMLElement | null) {
  if (!node) return;
  node.setAttribute("translate", "no");
  node.classList.add("notranslate");
}

const Toaster = ({ className, ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      ref={protectToasterNode}
      theme={theme as ToasterProps["theme"]}
      className={cn("toaster group notranslate", className)}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
