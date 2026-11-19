// Real browser fetch smoke, loopback only, no mock of window.fetch or credentials.
import { createServer } from "node:http";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const esbuild = createRequire(require.resolve("tsx/package.json"))("esbuild");
const bundle = await esbuild.build({
  stdin: { contents: `import { WorkspaceReader } from './src/lib/workspace-reader';
    const reader = new WorkspaceReader();
    document.querySelector('#read').addEventListener('click', async () => {
      const status = document.querySelector('[role=status]'); status.textContent='Cargando';
      try { const result=await reader.read('/api/workspace'); status.textContent=result.ok?'Lectura correcta':'Respuesta inválida'; }
      catch(error) { status.textContent=error.message; }
    });`, resolveDir: process.cwd(), loader: "ts" },
  bundle: true, write: false, platform: "browser", format: "iife",
});
createServer((request, response) => {
  if (request.url === "/api/workspace") {
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    response.end('{"ok":true}');
  } else if (request.url === "/fixture.js") {
    response.writeHead(200, { "content-type": "text/javascript" });
    response.end(bundle.outputFiles[0].contents);
  } else {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end('<!doctype html><html lang="es"><title>QA de lectura local</title><body><h1>QA de lectura local</h1><button id="read">Leer datos ficticios</button><p role="status">Sin iniciar</p><script src="/fixture.js"></script></body></html>');
  }
}).listen(3219, "127.0.0.1", () => console.log(`FETCH_QA_PID=${process.pid} http://127.0.0.1:3219`));
