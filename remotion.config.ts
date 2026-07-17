import { Config } from "@remotion/cli/config";
import path from "path";

Config.setEntryPoint("./remotion/Root.tsx");
Config.setPublicDir("./public");

// Teach the Remotion (webpack) bundler about the `@/*` -> project-root alias
// from tsconfig.json. Next.js resolves this natively, but the Remotion bundler
// does not, so any module imported via `@/...` (e.g. `@/lib/reveal-doc`) fails
// with "Module not found" during `remotion render`.
Config.overrideWebpackConfig((config) => {
  return {
    ...config,
    resolve: {
      ...config.resolve,
      alias: {
        ...(config.resolve?.alias ?? {}),
        "@": path.resolve(process.cwd()),
      },
    },
  };
});
