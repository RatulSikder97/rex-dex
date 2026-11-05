// electron-builder afterSign hook. Signed builds (CSC_LINK / CSC_NAME / keychain
// identity) are left alone. Unsigned local macOS builds get an ad-hoc signature so
// the bundle's seal stays valid after packaging (Apple Silicon refuses to run
// Mach-O binaries whose signature no longer matches).
const { execFileSync } = require("node:child_process");
const path = require("node:path");

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== "darwin") return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  try {
    execFileSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "pipe" });
    return; // validly signed (Developer ID, or already ad-hoc)
  } catch {
    /* invalid or missing signature: ad-hoc sign below */
  }
  const entitlements = path.join(__dirname, "..", "build", "entitlements.mac.plist");
  console.log(`  • ad-hoc signing ${path.basename(app)} (no signing identity configured)`);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", "--entitlements", entitlements, app], { stdio: "inherit" });
};
