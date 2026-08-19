import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline:
          "border bg-transparent shadow-xs hover:bg-accent dark:bg-transparent dark:border-input dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function stabilizeButtonChildren(children: React.ReactNode) {
  const normalized: React.ReactNode[] = [];
  let textParts: Array<string | number> = [];
  let labelIndex = 0;

  const flushText = () => {
    if (textParts.length === 0) return;
    normalized.push(
      <span key={`button-label-${labelIndex}`} data-slot="button-label">
        {textParts.join("")}
      </span>,
    );
    labelIndex += 1;
    textParts = [];
  };

  React.Children.forEach(children, (child) => {
    if (typeof child === "string" || typeof child === "number") {
      textParts.push(child);
      return;
    }
    if (child === null || child === undefined || typeof child === "boolean") {
      return;
    }

    flushText();
    if (React.isValidElement(child) && child.type === React.Fragment) {
      const fragment = child as React.ReactElement<{
        children?: React.ReactNode;
      }>;
      normalized.push(
        React.cloneElement(
          fragment,
          undefined,
          stabilizeButtonChildren(fragment.props.children),
        ),
      );
      return;
    }
    normalized.push(child);
  });
  flushText();

  return normalized;
}

function Button({
  className,
  variant,
  size,
  asChild = false,
  children,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    >
      {asChild ? children : stabilizeButtonChildren(children)}
    </Comp>
  );
}

function ButtonSpinner({
  pending,
  className,
}: {
  pending: boolean;
  className?: string;
}) {
  return (
    <span
      data-slot="button-spinner"
      aria-hidden="true"
      className={cn("size-4 shrink-0", !pending && "hidden", className)}
    >
      <Loader2 className={cn("size-4", pending && "animate-spin")} />
    </span>
  );
}

export { Button, ButtonSpinner, buttonVariants };
