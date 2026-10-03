module.exports = function (api) {
  const production = api.env("production");
  api.cache.using(() => process.env.NODE_ENV);
  return {
    presets: [["babel-preset-expo", { jsxImportSource: "nativewind" }], "nativewind/babel"],
    // Production builds contain no console output at all (no tokens or personal data can leak via logs).
    plugins: production ? [["transform-remove-console", { exclude: [] }]] : [],
  };
};
