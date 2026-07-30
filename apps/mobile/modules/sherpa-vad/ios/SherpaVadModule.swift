import ExpoModulesCore

struct VadOptions: Record {
  @Field var modelPath: String = ""
  @Field var sampleRate: Int = 16_000
  @Field var threshold: Float = 0.5
  @Field var minSilenceDuration: Float = 0.25
  @Field var minSpeechDuration: Float = 0.25
  @Field var windowSize: Int = 512
  @Field var maxSpeechDuration: Float = 5
  @Field var numThreads: Int = 1
  @Field var provider: String = "cpu"
}

public final class SherpaVadModule: Module {
  private var detectors: [String: SherpaVadBridge] = [:]

  public func definition() -> ModuleDefinition {
    Name("SherpaVad")

    AsyncFunction("initialize") { (id: String, options: VadOptions) in
      guard self.detectors[id] == nil else {
        throw Exception(name: "VadAlreadyExists", description: "VAD instance already exists")
      }
      guard let detector = SherpaVadBridge(
        modelPath: options.modelPath,
        sampleRate: options.sampleRate,
        threshold: options.threshold,
        minSilenceDuration: options.minSilenceDuration,
        minSpeechDuration: options.minSpeechDuration,
        windowSize: options.windowSize,
        maxSpeechDuration: options.maxSpeechDuration,
        numThreads: options.numThreads,
        provider: options.provider
      ) else {
        throw Exception(name: "VadInitializationFailed", description: "Unable to initialize VAD")
      }
      self.detectors[id] = detector
    }

    AsyncFunction("acceptWaveform") { (id: String, samples: [Float]) in
      try self.requireDetector(id).acceptWaveform(samples.map(NSNumber.init))
    }

    AsyncFunction("flush") { (id: String) in
      try self.requireDetector(id).flush()
    }

    AsyncFunction("destroy") { (id: String) in
      self.detectors.removeValue(forKey: id)
    }

    OnDestroy {
      self.detectors.removeAll()
    }
  }

  private func requireDetector(_ id: String) throws -> SherpaVadBridge {
    guard let detector = detectors[id] else {
      throw Exception(name: "VadNotFound", description: "Unknown VAD instance")
    }
    return detector
  }
}
