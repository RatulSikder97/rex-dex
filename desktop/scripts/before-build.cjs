// electron-builder beforeBuild hook. Returning false tells electron-builder that
// node_modules are handled externally: the shell (desktop/app) has no dependencies,
// and the engine's modules ship as extraResources from desktop/stage/server.
// (Without this, electron-builder 26 falls back to collecting the *root* project's
// dependencies into app.asar.)
exports.default = async function beforeBuild() {
  return false;
};
