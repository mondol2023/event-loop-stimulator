import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SimulationEngine } from "@/core/timeline/SimulationEngine";
import { TimelineStore } from "@/core/timeline/TimelineStore";
import { handleRequest } from "./handleRequest";
import { parseRequest, parseResponse, type PipelineResponse, TIMELINE_MAX_CHARS } from "./protocol";

const FIXTURES = join(process.cwd(), "tests", "conformance", "fixtures");
const fixtureSource = readFileSync(join(FIXTURES, "nexttick-vs-promise.cjs"), "utf8");
const fixtureStdout = (JSON.parse(readFileSync(join(FIXTURES, "nexttick-vs-promise.expected.json"), "utf8")) as { outcomes: { stdout: string }[] }).outcomes[0]?.stdout;

function run(source: string, jobId = 7, lang: "js" | "ts" = "js"): PipelineResponse[] {
  const posted: PipelineResponse[] = [];
  handleRequest({ type: "run", jobId, source, lang }, (r) => posted.push(r));
  return posted;
}

afterEach(() => vi.restoreAllMocks());

describe("parseRequest", () => {
  const valid = { type: "run", jobId: 1, source: "", lang: "js" };

  it("accepts a well-formed request", () => {
    expect(parseRequest(valid)).toEqual(valid);
  });

  it("cannot carry natives or the test262 host (D6)", () => {
    expect(parseRequest({ ...valid, natives: true })).toBeNull();
    expect(parseRequest({ ...valid, host: "test262" })).toBeNull();
  });

  it.each([
    ["jobId 0", { ...valid, jobId: 0 }],
    ["fractional jobId", { ...valid, jobId: 1.5 }],
    ["lang py", { ...valid, lang: "py" }],
    ["non-string source", { ...valid, source: 42 }],
    ["oversized source", { ...valid, source: "x".repeat(65_537) }],
    ["wrong type", { ...valid, type: "walk" }],
    ["not an object", "run"],
  ])("rejects %s", (_name, data) => {
    expect(parseRequest(data)).toBeNull();
  });
});

describe("handleRequest", () => {
  it("posts compiled then simulated for a valid program, reproducing the recorded stdout", () => {
    const posted = run(fixtureSource, 3);
    expect(posted.map((r) => r.type)).toEqual(["compiled", "simulated"]);
    expect(posted.every((r) => r.jobId === 3)).toBe(true);
    const [compiled, sim] = posted;
    if (compiled?.type !== "compiled" || sim?.type !== "simulated") throw new Error("unexpected order");
    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.strippedJs).toBe(fixtureSource);
    expect(compiled.views).not.toBeNull();
    expect(compiled.lineIndex).not.toBeNull();
    expect(compiled.baselines).not.toBeNull();
    expect(compiled.baselines?.length).toBe(compiled.views?.bytecode.functions.length);

    const store = TimelineStore.deserialize(sim.timeline);
    expect(store.length).toBe(sim.tickCount);
    expect(sim.boundaries[0]).toBe(0);
    expect(sim.exitCode).toBe(0);
    expect(sim.stop).toBeNull();
    const last = store.at(store.length - 1);
    const stdout = last.console.filter((l) => l.stream === "stdout").map((l) => l.text).join("");
    expect(stdout).toBe(fixtureStdout);
  });

  it("posts only compiled, with nulls, when the program has diagnostics", () => {
    const posted = run("Math.random()");
    expect(posted).toHaveLength(1);
    const [compiled] = posted;
    if (compiled?.type !== "compiled") throw new Error("expected compiled");
    expect(compiled.diagnostics.map((d) => d.code)).toContain("E_EXCLUDED_API");
    expect(compiled.views).toBeNull();
    expect(compiled.lineIndex).toBeNull();
    expect(compiled.baselines).toBeNull();
  });

  it("compiles TypeScript and indexes the stripped JavaScript", () => {
    const [compiled] = run("let x: number = 1; console.log(x);", 1, "ts");
    if (compiled?.type !== "compiled") throw new Error("expected compiled");
    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.strippedJs).not.toContain(": number");
  });

  it("every response passes parseResponse and survives structuredClone unchanged", () => {
    for (const response of [...run(fixtureSource), ...run("Math.random()")]) {
      expect(parseResponse(response)).toEqual(response);
      expect(structuredClone(response)).toEqual(response);
    }
  });

  it("reports a stopped run in `stop`", () => {
    const posted = run("while (true) {}");
    const sim = posted.find((r) => r.type === "simulated");
    if (sim?.type !== "simulated") throw new Error("expected simulated");
    expect(sim.stop).not.toBeNull();
    expect(parseResponse(sim)).toEqual(sim);
  });

  it("posts failed, without the source text, when the engine throws", () => {
    const secret = "const secretMarker = 'do-not-leak';";
    vi.spyOn(SimulationEngine.prototype, "run").mockImplementation(() => {
      throw new Error("engine blew up");
    });
    const posted = run(secret);
    const last = posted[posted.length - 1];
    if (last?.type !== "failed") throw new Error("expected failed");
    expect(last.message).toBe("engine blew up");
    expect(last.jobId).toBe(7);
    expect(JSON.stringify(posted.at(-1))).not.toContain("secretMarker");
    expect(parseResponse(last)).toEqual(last);
  });

  it("truncates the failure message to 500 characters", () => {
    vi.spyOn(SimulationEngine.prototype, "run").mockImplementation(() => {
      throw new Error("e".repeat(2000));
    });
    const last = run("let a = 1;").at(-1);
    if (last?.type !== "failed") throw new Error("expected failed");
    expect(last.message).toHaveLength(500);
  });

  it("does not echo the source when the thrown value is not an Error", () => {
    vi.spyOn(SimulationEngine.prototype, "run").mockImplementation(() => {
      throw "string thrown";
    });
    const last = run("let a = 1;").at(-1);
    if (last?.type !== "failed") throw new Error("expected failed");
    expect(last.message.length).toBeGreaterThan(0);
  });
});

describe("parseResponse", () => {
  const simulated = { type: "simulated", jobId: 1, timeline: "{}", boundaries: [0], tickCount: 1, exitCode: 0, warnings: [], stop: null };

  it("accepts a valid simulated response", () => {
    expect(parseResponse(simulated)).toEqual(simulated);
  });

  it("rejects an extra key (strict)", () => {
    expect(parseResponse({ ...simulated, extra: 1 })).toBeNull();
    expect(parseResponse({ type: "failed", jobId: 1, message: "m", extra: 1 })).toBeNull();
  });

  it("rejects a timeline over TIMELINE_MAX_CHARS", () => {
    expect(parseResponse({ ...simulated, timeline: "x".repeat(TIMELINE_MAX_CHARS + 1) })).toBeNull();
  });

  it("rejects a failed message over 500 characters and an unknown type", () => {
    expect(parseResponse({ type: "failed", jobId: 1, message: "m".repeat(501) })).toBeNull();
    expect(parseResponse({ type: "nope", jobId: 1 })).toBeNull();
  });

  it("rejects compiled views with malformed lines", () => {
    const [compiled] = run("let a = 1;");
    if (compiled?.type !== "compiled" || !compiled.views) throw new Error("expected views");
    const broken = { ...compiled, views: { ...compiled.views, ast: { lines: [{ text: 1, positions: [] }] } } };
    expect(parseResponse(broken)).toBeNull();
  });
});
