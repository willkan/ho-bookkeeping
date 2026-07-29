const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// Never bundle Node-only test SQLite into the mobile app.
config.resolver.blockList = [
  /better-sqlite3\/.*/,
  /.*\/better-sqlite-adapter\.ts$/,
  /.*\/open-test-database\.ts$/,
];

module.exports = config;
