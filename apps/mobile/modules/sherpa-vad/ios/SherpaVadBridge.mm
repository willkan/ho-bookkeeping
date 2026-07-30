#import "SherpaVadBridge.h"

#include <memory>
#include <vector>
#include <sherpa-onnx/c-api/cxx-api.h>

using sherpa_onnx::cxx::VadModelConfig;
using sherpa_onnx::cxx::VoiceActivityDetector;

@interface SherpaVadBridge () {
  std::unique_ptr<VoiceActivityDetector> _detector;
}
@end

@implementation SherpaVadBridge

- (nullable instancetype)initWithModelPath:(NSString *)modelPath
                                sampleRate:(NSInteger)sampleRate
                                 threshold:(float)threshold
                        minSilenceDuration:(float)minSilenceDuration
                         minSpeechDuration:(float)minSpeechDuration
                                windowSize:(NSInteger)windowSize
                         maxSpeechDuration:(float)maxSpeechDuration
                                numThreads:(NSInteger)numThreads
                                  provider:(NSString *)provider {
  self = [super init];
  if (self) {
    VadModelConfig config;
    config.silero_vad.model = modelPath.UTF8String;
    config.silero_vad.threshold = threshold;
    config.silero_vad.min_silence_duration = minSilenceDuration;
    config.silero_vad.min_speech_duration = minSpeechDuration;
    config.silero_vad.window_size = static_cast<int32_t>(windowSize);
    config.silero_vad.max_speech_duration = maxSpeechDuration;
    config.sample_rate = static_cast<int32_t>(sampleRate);
    config.num_threads = static_cast<int32_t>(numThreads);
    config.provider = provider.UTF8String;

    auto detector = VoiceActivityDetector::Create(config, 30.0f);
    if (!detector.Get()) {
      return nil;
    }
    _detector = std::make_unique<VoiceActivityDetector>(std::move(detector));
  }
  return self;
}

- (NSArray<NSDictionary<NSString *, id> *> *)acceptWaveform:(NSArray<NSNumber *> *)samples {
  std::vector<float> pcm;
  pcm.reserve(samples.count);
  for (NSNumber *sample in samples) {
    pcm.push_back(sample.floatValue);
  }
  _detector->AcceptWaveform(pcm.data(), static_cast<int32_t>(pcm.size()));
  return [self drain];
}

- (NSArray<NSDictionary<NSString *, id> *> *)flush {
  _detector->Flush();
  return [self drain];
}

- (NSArray<NSDictionary<NSString *, id> *> *)drain {
  NSMutableArray<NSDictionary<NSString *, id> *> *segments = [NSMutableArray array];
  while (!_detector->IsEmpty()) {
    auto segment = _detector->Front();
    NSMutableArray<NSNumber *> *samples = [NSMutableArray arrayWithCapacity:segment.samples.size()];
    for (float sample : segment.samples) {
      [samples addObject:@(sample)];
    }
    [segments addObject:@{
      @"start": @(segment.start),
      @"samples": samples,
    }];
    _detector->Pop();
  }
  return segments;
}

@end
