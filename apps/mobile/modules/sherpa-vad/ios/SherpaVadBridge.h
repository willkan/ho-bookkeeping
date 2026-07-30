#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface SherpaVadBridge : NSObject

- (nullable instancetype)initWithModelPath:(NSString *)modelPath
                                sampleRate:(NSInteger)sampleRate
                                 threshold:(float)threshold
                        minSilenceDuration:(float)minSilenceDuration
                         minSpeechDuration:(float)minSpeechDuration
                                windowSize:(NSInteger)windowSize
                         maxSpeechDuration:(float)maxSpeechDuration
                                numThreads:(NSInteger)numThreads
                                  provider:(NSString *)provider;

- (NSArray<NSDictionary<NSString *, id> *> *)acceptWaveform:(NSArray<NSNumber *> *)samples;
- (NSArray<NSDictionary<NSString *, id> *> *)flush;

@end

NS_ASSUME_NONNULL_END
