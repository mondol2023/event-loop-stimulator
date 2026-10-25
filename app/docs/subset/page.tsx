import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import { Fragment } from "react";
import { EXCLUDED } from "@/core/frontend/subset/excluded";
import { MAX_LINES, MAX_SOURCE_BYTES } from "@/core/frontend/subset/validator";
import { DIAGNOSTIC_CODES, type DiagnosticCode } from "@/core/shared/diagnostics";
import { LIMITS } from "@/core/shared/limits";

export const metadata: Metadata = { title: "Supported subset" };

const nf = new Intl.NumberFormat("en-US");

// The simulation limits in plain words; the numbers come from LIMITS, so this table cannot drift from the runtime.
const LIMIT_ROWS: readonly { name: string; value: string; meaning: string }[] = [
  { name: "Source size", value: `${nf.format(MAX_SOURCE_BYTES)} bytes`, meaning: "The most UTF-8 text the editor will compile." },
  { name: "Source lines", value: nf.format(MAX_LINES), meaning: "The most lines the editor will compile." },
  { name: "Ticks", value: nf.format(LIMITS.ticks), meaning: "Steps of the timeline: one per dispatch, job start, loop-phase change, GC event and exit." },
  { name: "Call depth", value: nf.format(LIMITS.callDepth), meaning: "Your functions active at once, counting the module wrapper." },
  { name: "Heap objects", value: nf.format(LIMITS.heapObjects), meaning: "Objects your program creates, counted over the whole run." },
  { name: "Virtual time", value: `${nf.format(LIMITS.virtualTimeMs)} ms`, meaning: "The longest run on the simulated clock; timers due by then still fire." },
  { name: "Builtin work", value: nf.format(LIMITS.work), meaning: "Element visits inside builtins, such as a map over an enormous array." },
  { name: "Output", value: `${nf.format(LIMITS.outputChars)} characters`, meaning: "What the program may write to stdout and stderr together." },
  { name: "Built strings", value: `${nf.format(LIMITS.stringChars)} characters`, meaning: "Everything built by concatenation or join, added up over the run." },
];

const CODE_MEANING: Readonly<Record<DiagnosticCode, string>> = {
  E_SYNTAX: "The source is not valid JavaScript or TypeScript, so it cannot be parsed.",
  E_TS_UNSUPPORTED: "A TypeScript feature that needs more than removing type annotations. Node does not run it either.",
  E_EXCLUDED_FEATURE: "A language feature left out on purpose, because it cannot be shown faithfully.",
  E_EXCLUDED_API: "A global or API left out on purpose: it needs the real world, such as the network, files or randomness.",
  E_NOT_YET_SUPPORTED: "A feature that could be added later, once it has fixtures recorded on real Node.",
  E_LIMIT_SOURCE_SIZE: "The source is larger than the size limit.",
  E_LIMIT_LINES: "The source has more lines than the limit.",
};

// Table labels use backticks for code; render them as <code> instead of showing the marks.
function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split("`").map((part, i) =>
        i % 2 === 1 ? (
          <code key={i} className="rounded-sm bg-muted px-1 font-mono text-[0.9em]">
            {part}
          </code>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

const TH = "py-2 pr-4 text-left font-medium text-foreground";
const TD = "py-2 pr-4 align-top";

// Server Component in Read mode: a 70ch measure, no client JS.
export default function SubsetPage() {
  return (
    <main className="mx-auto max-w-[70ch] px-4 py-10 text-base leading-relaxed text-foreground">
      <a href="/playground" className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        <ArrowLeft aria-hidden="true" className="size-4" />
        Back to the playground
      </a>
      <h1 className="mt-6 text-3xl font-semibold tracking-tight">Supported subset</h1>
      <p className="mt-4 text-muted-foreground">
        The playground runs one self-contained script. Anything outside the subset is refused with a diagnostic over the offending token and a hint, never approximated. Your code is parsed and simulated, never executed.
      </p>

      <h2 id="limits" className="mt-10 scroll-mt-4 text-xl font-semibold">
        Limits
      </h2>
      <p className="mt-2 text-muted-foreground">When a run reaches one of these it stops with a notice, while real Node would carry on.</p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className={TH}>Limit</th>
              <th scope="col" className={TH}>Value</th>
              <th scope="col" className={TH}>Meaning</th>
            </tr>
          </thead>
          <tbody>
            {LIMIT_ROWS.map((row) => (
              <tr key={row.name} className="border-b border-border">
                <th scope="row" className={`${TD} text-left font-medium`}>{row.name}</th>
                <td className={`${TD} whitespace-nowrap`}>{row.value}</td>
                <td className={`${TD} text-muted-foreground`}>{row.meaning}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mt-10 text-xl font-semibold">Diagnostic codes</h2>
      <p className="mt-2 text-muted-foreground">Each problem the editor reports carries one of these codes and links here.</p>
      {DIAGNOSTIC_CODES.map((code) => {
        const entries = EXCLUDED.filter((e) => e.code === code);
        return (
          <section key={code} className="mt-8">
            <h3 id={code} className="scroll-mt-4 font-mono text-lg font-semibold">
              {code}
            </h3>
            <p className="mt-1 text-muted-foreground">{CODE_MEANING[code]}</p>
            {entries.length > 0 ? (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <caption className="sr-only">{`Constructs refused with ${code}`}</caption>
                  <thead>
                    <tr className="border-b border-border">
                      <th scope="col" className={TH}>Construct</th>
                      <th scope="col" className={TH}>What to do instead</th>
                      <th scope="col" className={TH}>Why</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e) => (
                      <tr key={e.id} className="border-b border-border">
                        <th scope="row" className={`${TD} text-left font-normal`}><Inline text={e.label} /></th>
                        <td className={TD}><Inline text={e.hint} /></td>
                        <td className={`${TD} text-muted-foreground`}><Inline text={e.reason} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
        );
      })}
    </main>
  );
}
