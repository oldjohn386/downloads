/* eslint-disable no-console */
/* eslint-disable import/no-extraneous-dependencies */
const path = require('path');
const fs = require('fs-extra');
const builder = require('electron-builder');
const { spawn } = require('child_process');
const glob = require('glob');
const del = require('del');
const { getSignVendorPath } = require('app-builder-lib/out/codeSign/windowsCodeSign');
const { notarize } = require('electron-notarize');

const displayLanguages = require('./src/constants/display-languages').default;

// https://stackoverflow.com/a/17466459
const runCmd = (cmd, args, callBack) => {
  const child = spawn(cmd, args);
  let resp = '';

  child.stdout.on('data', (buffer) => { resp += buffer.toString(); });
  child.stdout.on('end', () => { callBack(resp); });
};

const { Platform } = builder;

console.log(`Machine: ${process.platform}`);

const appVersion = fs.readJSONSync(path.join(__dirname, 'package.json')).version;

let targets;
switch (process.platform) {
  case 'darwin': {
    // targets = Platform.MAC.createTarget(['mas-dev']);
    targets = Platform.MAC.createTarget(['mas', 'zip', 'dmg']);
    break;
  }
  case 'win32': {
    // targets = Platform.WINDOWS.createTarget(['nsis']);
    targets = Platform.WINDOWS.createTarget(['appx']);
    break;
  }
  default:
  case 'linux': {
    targets = Platform.LINUX.createTarget(['snap', 'AppImage']);
    break;
  }
}

const opts = {
  targets,
  config: {
    appId: 'com.moderntranslator.app', // Backward compatibility
    // https://github.com/electron-userland/electron-builder/issues/3730
    buildVersion: process.platform === 'darwin' ? appVersion : undefined,
    productName: 'Translatium',
    files: [
      '!docs/**/*',
      '!popclip/**/*',
      '!test/**/*',
    ],
    directories: {
      buildResources: 'build-resources',
    },
    protocols: {
      name: 'Translatium',
      schemes: ['translatium'],
    },
    appx: {
      applicationId: 'translatium',
      identityName: '55974nhutquang97.5translate',
      publisher: 'CN=C635F506-DEEB-41A4-8CAA-16689F486ED2',
    },
    mac: {
      darkModeSupport: true,
    },
    mas: {
      category: 'public.app-category.productivity',
      entitlements: 'build-resources/entitlements.mas.plist',
      // provisioningProfile: 'build-resources/embedded-development.provisionprofile',
      provisioningProfile: 'build-resources/embedded.provisionprofile',
      hardenedRuntime: true,
      darkModeSupport: true,
    },
    linux: {
      category: 'Utility',
      packageCategory: 'utils',
    },
    /*
    publish: process.platform === 'linux' ? [
      {
        provider: 'snapStore',
        channels: ['stable', 'edge'],
      },
      'github',
    ] : undefined, // use default on non-linux platforms
    */
    afterPack: ({ appOutDir }) => new Promise((resolve, reject) => {
      console.log('afterPack', appOutDir, process.platform);

      const languages = Object.keys(displayLanguages);

      if (process.platform === 'darwin') {
        glob(`${appOutDir}/Translatium.app/Contents/Resources/!(${languages.join('|').replace(/-/g, '_')}).lproj`, (err, files) => {
          console.log('Deleting redundant *.lproj files...');
          if (err) return reject(err);
          return del(files).then(resolve, reject);
        });
      } else {
        resolve();
      }
    }),
    afterSign: (context) => {
      // Only notarize app when forced in pull requests or when releasing using tag
      const shouldNotarize = context.electronPlatformName === 'darwin'
        && ((process.env.TRAVIS_PULL_REQUEST === 'true' && process.env.CSC_FOR_PULL_REQUEST === 'true')
        || process.env.TRAVIS_TAG);
      if (!shouldNotarize) return null;

      console.log('Notarizing app...');
      // https://kilianvalkhof.com/2019/electron/notarizing-your-electron-application/
      console.log(context);
      const { appOutDir } = context;

      const appName = context.packager.appInfo.productFilename;

      return notarize({
        appBundleId: 'com.moderntranslator.app',
        appPath: `${appOutDir}/${appName}.app`,
        appleId: process.env.APPLE_ID,
        appleIdPassword: process.env.APPLE_ID_PASSWORD,
      });
    },
    afterAllArtifactBuild: () => {
      if (process.platform !== 'win32') {
        return [];
      }
      // Create .appxbundle for backward compability
      // http://www.jonathanantoine.com/2016/04/12/windows-app-bundles-and-the-subsequent-submissions-must-continue-to-contain-a-windows-phone-8-1-appxbundle-error-message/
      // https://docs.microsoft.com/en-us/windows/msix/package/create-app-package-with-makeappx-tool
      // https://github.com/electron-userland/electron-builder/blob/master/packages/app-builder-lib/src/targets/AppxTarget.ts
      const appxBundlePath = path.join('dist', `Translatium ${appVersion}.appxbundle`);
      const appxPath = path.join(__dirname, 'dist', `Translatium ${appVersion}.appx`);
      const bundleDirPath = path.join(__dirname, 'dist', 'appx_bundle');
      const appxDestPath = path.join(bundleDirPath, 'Translatium.appx');
      return getSignVendorPath()
        .then((vendorPath) => {
          console.log(`Creating ${appxBundlePath}...`);
          fs.ensureDirSync(bundleDirPath);
          fs.copyFileSync(appxPath, appxDestPath);
          return new Promise((resolve) => {
            const makeAppxPath = path.join(vendorPath, 'windows-10', 'x64', 'makeappx.exe');
            runCmd(makeAppxPath, ['bundle', '/p', appxBundlePath, '/d', bundleDirPath, '/o'], (text) => {
              console.log(text);
              resolve();
            });
          })
            .then(() => {
              console.log(`Created ${appxBundlePath} successfully`);
              return [appxBundlePath];
            });
        });
    },
  },
};

builder.build(opts)
  .then(() => {
    console.log('build successful');
  })
  .catch((err) => {
    console.log(err);
    process.exit(1);
  });
