import { httpRouter } from "convex/server";
import { uploadDocument, uploadOptions } from "./upload";

const http = httpRouter();

http.route({
  path: "/upload",
  method: "POST",
  handler: uploadDocument,
})

http.route({
  path: "/upload",
  method: "OPTIONS",
  handler: uploadOptions,
})

export default http;
