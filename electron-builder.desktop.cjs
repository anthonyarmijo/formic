const path = require('node:path');

const repoRoot = __dirname;
const serverBundleDir =
  process.env.FORMIC_ELECTRON_BUILDER_SERVER_DIR || path.join(repoRoot, 'build', 'desktop-rehearsal', 'formic-server');
const outputDir =
  process.env.FORMIC_ELECTRON_BUILDER_OUTPUT_DIR || path.join(repoRoot, 'build', 'desktop-rehearsal', 'packaged-app');
const signingMode = process.env.FORMIC_ELECTRON_BUILDER_SIGNING_MODE || 'unsigned';
const developerIdIdentity = process.env.FORMIC_DEVELOPER_IDENTITY || process.env.CSC_NAME || '';
const electronBuilderIdentity = developerIdIdentity.replace(/^Developer ID Application:\s*/, '');
const useDeveloperIdSigning = signingMode === 'developer-id';
const pythonSidecarSignIgnore = String.raw`/Contents/Resources/formic-server/.*`;

if (!['unsigned', 'developer-id'].includes(signingMode)) {
  throw new Error(`Unknown FORMIC_ELECTRON_BUILDER_SIGNING_MODE: ${signingMode}`);
}

if (useDeveloperIdSigning && !developerIdIdentity) {
  throw new Error('FORMIC_DEVELOPER_IDENTITY or CSC_NAME is required for Developer ID signing mode.');
}

module.exports = {
  appId: 'app.formic.desktop',
  productName: 'Formic',
  directories: {
    app: 'apps/desktop',
    output: outputDir
  },
  files: ['dist/**/*', 'package.json', '!node_modules', '!node_modules/**/*'],
  asar: true,
  extraResources: [
    {
      from: serverBundleDir,
      to: 'formic-server',
      filter: ['**/*', '**/.*']
    }
  ],
  npmRebuild: false,
  mac: {
    target: ['dir'],
    identity: useDeveloperIdSigning ? electronBuilderIdentity : null,
    hardenedRuntime: useDeveloperIdSigning,
    entitlements: useDeveloperIdSigning ? 'apps/desktop/signing/entitlements.mac.plist' : undefined,
    entitlementsInherit: useDeveloperIdSigning ? 'apps/desktop/signing/entitlements.mac.inherit.plist' : undefined,
    signIgnore: useDeveloperIdSigning ? [pythonSidecarSignIgnore] : undefined,
    notarize: false,
    gatekeeperAssess: false
  }
};
