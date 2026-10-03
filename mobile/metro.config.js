const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

/**
 * The app lives next to the web app (not in its npm workspace, because the two pin different
 * React versions). It imports TypeScript source from ../packages/shared, so Metro watches that
 * folder and maps "@fitcrm/shared" to it. Bare imports made *from* the shared package (zod) must
 * still resolve to this app's node_modules — never the web app's — so there's one copy of each.
 */
const projectRoot = __dirname;
const sharedRoot = path.resolve(projectRoot, "../packages/shared");
const PINNED_TO_APP = ["zod"];

const config = getDefaultConfig(projectRoot);
config.watchFolders = [sharedRoot];
config.resolver.extraNodeModules = { "@fitcrm/shared": sharedRoot };

const defaultResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = defaultResolve ?? context.resolveRequest;
  const pinned = PINNED_TO_APP.some((name) => moduleName === name || moduleName.startsWith(`${name}/`));
  if (pinned && context.originModulePath.startsWith(sharedRoot)) {
    // Resolve as if imported from the app itself.
    return resolve({ ...context, originModulePath: path.join(projectRoot, "index.js") }, moduleName, platform);
  }
  return resolve(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: "./src/global.css" });
