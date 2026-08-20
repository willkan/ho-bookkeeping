const { withAppBuildGradle } = require('expo/config-plugins');

const SIGNING_CONFIG = `
        release {
            def huanaStoreFile = System.getenv('HUANA_ANDROID_KEYSTORE_FILE')
            if (huanaStoreFile != null) {
                storeFile file(huanaStoreFile)
                storePassword System.getenv('HUANA_ANDROID_KEYSTORE_PASSWORD')
                keyAlias System.getenv('HUANA_ANDROID_KEY_ALIAS')
                keyPassword System.getenv('HUANA_ANDROID_KEY_PASSWORD')
            }
        }`;

function withAndroidReleaseSigning(config) {
  return withAppBuildGradle(config, (gradleConfig) => {
    if (gradleConfig.modResults.language !== 'groovy') {
      throw new Error('花哪 Android release signing requires a Groovy app/build.gradle');
    }

    let source = gradleConfig.modResults.contents;
    const debugConfigEnd = `            keyPassword 'android'\n        }\n    }`;
    if (!source.includes(debugConfigEnd)) {
      throw new Error('Could not locate Expo Android debug signing config');
    }
    source = source.replace(
      debugConfigEnd,
      `            keyPassword 'android'\n        }${SIGNING_CONFIG}\n    }`,
    );

    const debugReleaseSigning = `            signingConfig signingConfigs.debug\n            def enableShrinkResources`;
    if (!source.includes(debugReleaseSigning)) {
      throw new Error('Could not locate Expo Android release signing assignment');
    }
    source = source.replace(
      debugReleaseSigning,
      `            def huanaStoreFile = System.getenv('HUANA_ANDROID_KEYSTORE_FILE')\n            def huanaReleaseRequested = gradle.startParameter.taskNames.any { it.toLowerCase().contains('release') }\n            if (huanaReleaseRequested && huanaStoreFile == null) {\n                throw new GradleException('HUANA_ANDROID_KEYSTORE_FILE is required for release builds')\n            }\n            signingConfig huanaStoreFile != null ? signingConfigs.release : null\n            def enableShrinkResources`,
    );

    gradleConfig.modResults.contents = source;
    return gradleConfig;
  });
}

module.exports = withAndroidReleaseSigning;
