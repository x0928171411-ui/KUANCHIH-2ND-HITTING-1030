"use client";

import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import * as React from "react";
import { cn } from "@/lib/utils";

export function ToggleGroup({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return (
    <ToggleGroupPrimitive.Root
      className={cn("inline-flex rounded-lg border border-line bg-[#071821] p-0.5", className)}
      {...props}
    />
  );
}

export function ToggleGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return (
    <ToggleGroupPrimitive.Item
      className={cn(
        "h-8 rounded-md px-2.5 text-[13px] font-semibold text-[#b7c9d6] transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan data-[state=on]:bg-[#14384c] data-[state=on]:text-white",
        className,
      )}
      {...props}
    />
  );
}
