import resolve from "rollup-plugin-node-resolve";
import commonjs from "rollup-plugin-commonjs";
import { terser } from "rollup-plugin-terser";
import replace from "rollup-plugin-replace";

const PROD = process.env.BUILD === "production";

console.log(`production: ${PROD}`);

const plugins = [
  replace({
    "process.env.NODE_ENV": JSON.stringify(PROD ? "production" : "development")
  }),
  resolve({
    browser: true,
    preferBuiltins: false,
  }),
  commonjs({
    ignoreGlobal: true
  }),
  PROD && terser({})
];

const banner = `/*! https://github.com/menduz/beakman - Apache 2.0 - ${JSON.stringify(
  {
    date: new Date().toISOString(),
    commit: process.env.GITHUB_SHA || "HEAD",
    ref: process.env.GITHUB_REF || "?"
  },
  null,
  2
)} */`;

export default {
  input: "./dist/index.js",
  context: "document",
  plugins,
  output: [
    {
      file: `./dist-web/beakman${PROD ? '.min' : ''}.js`,
      format: "iife",
      name: "Beakman",
      banner
    }
  ],
  external: []
};
