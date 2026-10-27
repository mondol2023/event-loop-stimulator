import type { HardwareFrame } from "../../playground/hooks/useHardwareFrame";

/** What a register without a modelled value shows. */
export const NO_VALUE = "—";

/** The four registers the machine model keeps; every other register has no modelled value. */
export function registerText(name: string, frame: HardwareFrame | null): string {
  const registers = frame?.machine?.registers;
  if (!registers) return NO_VALUE;
  switch (name) {
    case "rax":
    case "rsi":
    case "rbp":
    case "rsp":
      return `0x${registers[name].toString(16)}`;
    default:
      return NO_VALUE;
  }
}
