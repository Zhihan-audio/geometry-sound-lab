// 打包后对 .app 做 ad-hoc 签名：Apple Silicon 上无签名的二进制无法启动，
// ad-hoc 签名让应用能在任何 Mac 上运行（首次打开仍需通过 Gatekeeper 放行）
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
