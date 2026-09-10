import * as esbuild from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";

const watch = process.argv.includes("--watch");
const serve = process.argv.includes("--serve");
const outdir = "dist";

async function copyStaticAssets() {
  await mkdir(outdir, { recursive: true });
  await cp("index.html", `${outdir}/index.html`);
  await cp("style.css", `${outdir}/style.css`);
  await cp("favicon.svg", `${outdir}/favicon.svg`);
  if (existsSync("samples")) {
    await cp("samples", `${outdir}/samples`, { recursive: true });
  }
}

if (existsSync(outdir)) {
  await rm(outdir, { recursive: true });
}
await copyStaticAssets();

const buildOptions = {
  entryPoints: ["src/ui/app.ts"],
  bundle: true,
  outfile: `${outdir}/app.js`,
  format: "esm",
  target: "es2020",
  minify: !watch,
  sourcemap: true,
  // The XML parser dynamically imports @xmldom/xmldom only as a Node-only
  // fallback for environments without a native DOMParser (i.e. the test
  // suite). The browser always has DOMParser, so that branch never runs
  // client-side -- marking the package external keeps it (and its Node
  // built-in usage) out of the shipped browser bundle entirely.
  external: ["@xmldom/xmldom"],
  logLevel: "info",
};

if (watch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  if (serve) {
    const { host, port } = await ctx.serve({ servedir: outdir, port: 8080 });
    console.log(`Serving http://${host}:${port}`);
  }
} else {
  await esbuild.build(buildOptions);
  console.log("Build complete ->", outdir);
}
