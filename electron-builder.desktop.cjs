const path = require('node:path');

const repoRoot = __dirname;
const serverBundleDir =
  process.env.FORMIC_ELECTRON_BUILDER_SERVER_DIR || path.join(repoRoot, 'build', 'desktop-rehearsal', 'formic-server');
const outputDir =
  process.env.FORMIC_ELECTRON_BUILDER_OUTPUT_DIR || path.join(repoRoot, 'build', 'desktop-rehearsal', 'packaged-app');

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
    identity: null,
    hardenedRuntime: false,
    gatekeeperAssess: false
  }
};
