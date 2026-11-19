// Node-only server-render tests cannot load styles as JavaScript.
import { registerHooks } from "node:module";
registerHooks({
  load(url, context, next) {
    return url.endsWith(".css")
      ? { format: "module", source: "", shortCircuit: true }
      : next(url, context);
  },
});
