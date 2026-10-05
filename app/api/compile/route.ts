import { handleCompile } from "@/server/compile/handleCompile";

// Routing only: the pipeline lives in server/compile/handleCompile.ts.
export async function POST(request: Request): Promise<Response> {
  return handleCompile(request);
}
