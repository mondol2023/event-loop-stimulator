import type { BytecodeArrayBuilder } from "./BytecodeArrayBuilder";

// V8's ControlScope::DeferredCommands (src/interpreter/bytecode-generator.cc): the paths that enter
// the `finally` block of a try/finally, each tagged with a Smi token. After the block a dispatch on
// the token finishes whichever path got there: rethrow, return, break, continue or the fall-through
// at the end of the try block.

/** A control-flow transfer that has to pass through the `finally` blocks it leaves. */
export type Command =
  | { readonly kind: "break" | "continue"; /** The loop the jump is for. */ readonly target: object }
  | { readonly kind: "return" }
  | { readonly kind: "rethrow" };

/** `TryFinallyContinuationToken`: no path is recorded under it. */
const FALLTHROUGH_TOKEN = -1;
const RETHROW_TOKEN = 0;

interface Entry {
  readonly command: Command;
  readonly token: number;
}

/** Return and rethrow carry a value in the result register; break and continue do not. */
function usesAccumulator(command: Command): boolean {
  return command.kind === "return" || command.kind === "rethrow";
}

export type DeferredRegisters = {
  /** Holds the token of the path that entered the `finally` block. */
  readonly token: number;
  /** Holds the value being returned or the exception being rethrown. */
  readonly result: number;
  /** Holds the pending message cleared on the way in, put back on rethrow. */
  readonly message: number;
};

export class DeferredCommands {
  // There is always a rethrow path.
  private readonly entries: Entry[] = [{ command: { kind: "rethrow" }, token: RETHROW_TOKEN }];
  private returnToken = -1;
  private fallThroughNeeded = false;

  /** `perform` runs a command in the control scopes outside the try/finally. */
  constructor(
    private readonly builder: BytecodeArrayBuilder,
    private readonly registers: DeferredRegisters,
    private readonly perform: (command: Command) => void,
  ) {}

  /** Stores what the path carries and its token while entering the `finally` block. */
  recordCommand(command: Command): void {
    const b = this.builder;
    const token = this.tokenFor(command);
    if (usesAccumulator(command)) b.emit("Star", this.registers.result);
    this.loadToken(token);
    b.emit("Star", this.registers.token);
    // Break and continue store the token in the result too, so the register still counts as written.
    if (!usesAccumulator(command)) b.emit("Star", this.registers.result);
    if (command.kind === "rethrow") {
      // The message is cleared on the way in and put back if the exception is rethrown.
      b.emit("LdaTheHole");
      b.emit("SetPendingMessage");
      b.emit("Star", this.registers.message);
    }
  }

  /** The exception is in the accumulator when the handler is entered. */
  recordHandlerRethrowPath(): void {
    this.recordCommand({ kind: "rethrow" });
  }

  /** The end of the try block flowing into the `finally` block. */
  recordFallThroughPath(): void {
    this.fallThroughNeeded = true;
    this.loadToken(FALLTHROUGH_TOKEN);
    this.builder.emit("Star", this.registers.token);
    this.builder.emit("Star", this.registers.result);
  }

  /** Dispatches on the token after the `finally` block and carries out the path that entered it. */
  applyDeferredCommands(): void {
    const b = this.builder;
    const fallThrough = b.newLabel();
    const [first, ...rest] = this.entries;
    if (!first) return;
    if (this.entries.length === 1) {
      // A single path: anything that is not it is the fall-through.
      if (this.fallThroughNeeded) {
        this.loadToken(first.token);
        b.emit("TestReferenceEqual", this.registers.token);
        b.jump("JumpIfFalse", fallThrough);
      }
      this.applyCommand(first);
    } else {
      // Without a fall-through the table leaves out token 0, whose code follows the switch.
      const base = this.fallThroughNeeded ? 0 : 1;
      const size = this.entries.length - base;
      if (size === 1) {
        const final = rest[0] as Entry;
        const toFinal = b.newLabel();
        this.loadToken(first.token);
        b.emit("TestReferenceEqual", this.registers.token);
        b.jump("JumpIfFalse", toFinal);
        this.applyCommand(first);
        b.bind(toFinal);
        this.applyCommand(final);
      } else {
        const table = b.allocateJumpTable(size, base);
        b.emit("Ldar", this.registers.token);
        b.switchOnSmiNoFeedback(table);
        if (this.fallThroughNeeded) {
          b.jump("Jump", fallThrough);
          b.bindJumpTableEntry(table, first.token);
        }
        this.applyCommand(first);
        for (const entry of rest) {
          b.bindJumpTableEntry(table, entry.token);
          this.applyCommand(entry);
        }
      }
    }
    if (this.fallThroughNeeded) b.bind(fallThrough);
  }

  private applyCommand(entry: Entry): void {
    const b = this.builder;
    if (entry.command.kind === "rethrow") {
      b.emit("Ldar", this.registers.message);
      b.emit("SetPendingMessage");
    }
    if (usesAccumulator(entry.command)) b.emit("Ldar", this.registers.result);
    this.perform(entry.command);
  }

  /** Return and rethrow share one token each; every break and continue gets a new one. */
  private tokenFor(command: Command): number {
    if (command.kind === "rethrow") return RETHROW_TOKEN;
    if (command.kind === "return") {
      if (this.returnToken === -1) this.returnToken = this.newToken(command);
      return this.returnToken;
    }
    return this.newToken(command);
  }

  private newToken(command: Command): number {
    const token = this.entries.length;
    this.entries.push({ command, token });
    return token;
  }

  private loadToken(token: number): void {
    if (token === 0) this.builder.emit("LdaZero");
    else this.builder.emit("LdaSmi", token);
  }
}
