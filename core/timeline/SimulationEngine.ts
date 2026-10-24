import type { BytecodeProgram } from "@/core/bytecode/BytecodeProgram";
import { DETACHED_HOST, NodeEventLoop } from "@/core/host/NodeEventLoop";
import { installTest262Harness } from "@/core/host/test262Harness";
import { IgnitionInterpreter, type StepObserver } from "@/core/interpreter/IgnitionInterpreter";
import type { TieringHooks, TieringReadout } from "@/core/interpreter/tiering/TieringModel";
import { GcModel } from "@/core/runtime/heap/GcModel";
import { Realm } from "@/core/runtime/Realm";
import { SimulationHalt } from "@/core/shared/simulationHalt";
import { GcObserver, type GcWorld } from "./GcObserver";
import { stopNotice, TickLimiter } from "./limits";
import type { SimulationOptions, SimulationResult } from "./simulate";
import { TickRecorder } from "./TickRecorder";

// Runs a compiled program on a fresh realm under Node's event loop and, unless asked not to,
// records its timeline. This is the only place a SimulationHalt is caught: a limit or an
// unsupported behavior ends the run with what it printed so far (Decision D3).

/** The model hands the timeline its readout through the same object it hands the interpreter its hooks. */
function isTieringReadout(hooks: TieringHooks | undefined): hooks is TieringHooks & TieringReadout {
  return hooks !== undefined && "tiers" in hooks && "drainEvents" in hooks;
}

export class SimulationEngine {
  run(program: BytecodeProgram, opts: SimulationOptions = {}): SimulationResult {
    const realm = new Realm(DETACHED_HOST);
    const recorder = opts.record === false ? undefined : new TickRecorder(program);
    const limiter = recorder ? undefined : new TickLimiter(program);
    const gc = new GcModel(realm.heap, opts.gc);
    const world = (): GcWorld => ({ realm, interpreter, loop });
    const observer: StepObserver = new GcObserver(recorder ?? limiter ?? { onCommand: () => undefined }, gc, world);
    const interpreter = new IgnitionInterpreter(program, realm, observer, opts.tiering);
    const loop = new NodeEventLoop(realm, interpreter, observer);
    if (opts.host === "test262") installTest262Harness(realm);
    const tiering = isTieringReadout(opts.tiering) ? opts.tiering : undefined;
    recorder?.attach({ interpreter, realm, gc, host: () => loop.view(), warnings: () => loop.warnings, ...(tiering ? { tiering } : {}) });
    const base = { diagnostics: [], ticks: recorder?.ticks ?? [] };
    const counted = (): number => recorder?.tickCount ?? limiter?.ticks ?? 0;
    try {
      const { exitCode } = loop.run();
      recorder?.finish();
      return { ...base, stdout: loop.stdout, stderr: loop.stderr, exitCode, warnings: [...loop.warnings], tickCount: counted() };
    } catch (e) {
      if (!(e instanceof SimulationHalt)) throw e;
      recorder?.finish();
      return {
        ...base,
        stdout: loop.stdout,
        stderr: loop.stderr,
        exitCode: 0,
        warnings: [...loop.warnings, stopNotice(e.stop)],
        stop: e.stop,
        tickCount: counted(),
      };
    }
  }
}
