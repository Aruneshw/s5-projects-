// src/components/ui/button.tsx — shadcn/ui-style Button (vendored source, as shadcn intends).
import * as React from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl font-semibold transition-colors disabled:opacity-50 disabled:pointer-events-none select-none [&_svg]:size-5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-leaf-700 text-white hover:bg-leaf-800 active:bg-leaf-800",
        outline: "border-2 border-line bg-card text-ink hover:bg-leaf-50",
        ghost: "text-ink hover:bg-leaf-50",
        danger: "bg-chilli-600 text-white hover:bg-chilli-700",
        warn: "bg-turmeric-600 text-white hover:bg-turmeric-700",
        link: "text-leaf-700 underline-offset-4 hover:underline px-0",
      },
      size: {
        default: "h-11 px-4 text-base",
        sm: "h-9 px-3 text-sm",
        lg: "h-14 px-6 text-lg",
        icon: "h-11 w-11",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot.Root : "button";
  return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
});
Button.displayName = "Button";
