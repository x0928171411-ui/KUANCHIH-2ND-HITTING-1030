"use client";

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        solid: "bg-cyan text-[#042029] hover:bg-[#8eecfb]",
        outline: "border border-line bg-[#071821] text-ink hover:border-cyan",
        quiet: "text-[#b7d0df] hover:text-white",
      },
      size: {
        md: "h-10 px-4",
        sm: "h-8 px-3 text-[13px]",
      },
    },
    defaultVariants: {
      variant: "solid",
      size: "md",
    },
  },
);

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
