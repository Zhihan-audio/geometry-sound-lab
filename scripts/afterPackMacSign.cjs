// Ad-hoc sign the .app after packaging: unsigned binaries will not launch on Apple Silicon;
// an ad-hoc signature lets the app run on any Mac (first launch still needs Gatekeeper approval)
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);
  if (!fs.existsSync(appPath)) return;
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
  console.log(`  • ad-hoc signed ${appName} (${path.basename(context.appOutDir)})`);
};
