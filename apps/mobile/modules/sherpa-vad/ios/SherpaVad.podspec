require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))
sherpa_root = File.expand_path('../../../../../node_modules/react-native-sherpa-onnx', __dir__)

Pod::Spec.new do |s|
  s.name = 'SherpaVad'
  s.version = package['version']
  s.summary = 'Thin Expo bridge for sherpa-onnx VoiceActivityDetector'
  s.description = 'Exposes the VAD API already shipped by react-native-sherpa-onnx.'
  s.license = 'MIT'
  s.author = 'Bookkeeping'
  s.homepage = 'https://github.com/willkan/ho-bookkeeping'
  s.platforms = { :ios => '15.1' }
  s.source = { :path => '.' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.dependency 'SherpaOnnx'

  s.source_files = '**/*.{h,m,mm,swift}'
  s.public_header_files = 'SherpaVadBridge.h'
  s.pod_target_xcconfig = {
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++17',
    'HEADER_SEARCH_PATHS' => [
      '$(inherited)',
      "\"#{sherpa_root}/ios/Frameworks/sherpa_onnx.xcframework/ios-arm64/Headers\"",
      "\"#{sherpa_root}/ios/Frameworks/sherpa_onnx.xcframework/ios-arm64_x86_64-simulator/Headers\""
    ].join(' ')
  }
end
