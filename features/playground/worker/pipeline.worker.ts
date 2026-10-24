import { handleRequest } from "./handleRequest";
import { parseRequest } from "./protocol";

// The pipeline worker's entry. The client only sends schema-built messages, so an invalid one is a
// bug, not an input: it is dropped without a reply.
self.onmessage = (e: MessageEvent<unknown>) => {
  const request = parseRequest(e.data);
  if (request) handleRequest(request, (message) => self.postMessage(message));
};
