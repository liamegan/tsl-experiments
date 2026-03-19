import { defineConfig } from "vite";
import pug from "pug";
import { resolve, relative, dirname, extname } from "path";
import { globSync, existsSync, mkdirSync, writeFileSync } from "fs";

const srcDir = resolve(__dirname, "src");
const pagesDir = resolve(srcDir, "pages");

// Rewrite relative src/href attributes to absolute paths from project root,
// so that ./index.ts in src/pages/basic/index.pug becomes /src/pages/basic/index.ts
// Rewrite relative src/href attributes to absolute paths from project root,
// so that ./index.ts in src/pages/basic/index.pug becomes /src/pages/basic/index.ts
function rewriteRelativePaths(html, pugFile) {
  const pugDir = dirname(pugFile);
  const rewrite = (url) => {
    if (/^(\/|https?:|\/\/)/.test(url)) return url;
    return "/" + relative(__dirname, resolve(pugDir, url));
  };
  return html
    .replace(
      /(<script[^>]+\bsrc=)(["'])([^"']+)\2/gi,
      (_, pre, q, url) => pre + q + rewrite(url) + q,
    )
    .replace(
      /(<link[^>]+\bhref=)(["'])([^"']+)\2/gi,
      (_, pre, q, url) => pre + q + rewrite(url) + q,
    );
}

function compilePug(file) {
  const html = pug.renderFile(file, { basedir: srcDir, filename: file });
  return rewriteRelativePaths(html, file);
}

// src/pages/foo/index.pug -> "foo", src/pages/index.pug -> ""
function pugToRoute(pugFile) {
  return pugFile
    .replace(/^src\/pages\//, "")
    .replace(/\/index\.pug$/, "")
    .replace(/\.pug$/, "");
}

// URL -> matching pug file, or null
function urlToPugFile(url) {
  const path = url.split("?")[0];
  if (extname(path) && extname(path) !== ".html") return null;

  const route = path
    .replace(/^\//, "")
    .replace(/\/$/, "")
    .replace(/index\.html$/, "");

  const candidates = route
    ? [resolve(pagesDir, route, "index.pug"), resolve(pagesDir, route + ".pug")]
    : [resolve(pagesDir, "index.pug")];

  return candidates.find(existsSync) ?? null;
}

function pugPages() {
  return {
    name: "pug-pages",

    config() {
      const input = {};
      for (const pugFile of globSync("src/pages/**/*.pug", {
        cwd: __dirname,
      })) {
        const route = pugToRoute(pugFile);
        const htmlFile = route
          ? resolve(__dirname, route, "index.html")
          : resolve(__dirname, "index.html");

        mkdirSync(dirname(htmlFile), { recursive: true });
        writeFileSync(htmlFile, compilePug(resolve(__dirname, pugFile)));
        input[route || "main"] = htmlFile;
      }
      return { build: { rollupOptions: { input } } };
    },

    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const pugFile = urlToPugFile(req.url);
        if (!pugFile) return next();

        const html = compilePug(pugFile);
        const transformed = await server.transformIndexHtml(
          req.url.split("?")[0],
          html,
        );
        res.setHeader("Content-Type", "text/html");
        res.end(transformed);
      });

      server.watcher.on("change", (file) => {
        if (file.endsWith(".pug")) server.ws.send({ type: "full-reload" });
      });
    },
  };
}

export default defineConfig({
  plugins: [pugPages()],
});
