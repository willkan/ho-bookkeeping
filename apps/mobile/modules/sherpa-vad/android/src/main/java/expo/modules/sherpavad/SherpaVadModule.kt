package expo.modules.sherpavad

import com.k2fsa.sherpa.onnx.SileroVadModelConfig
import com.k2fsa.sherpa.onnx.Vad
import com.k2fsa.sherpa.onnx.VadModelConfig
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.util.concurrent.ConcurrentHashMap

class VadOptions : Record {
  @Field
  var modelPath: String = ""

  @Field
  var sampleRate: Int = 16000

  @Field
  var threshold: Float = 0.5F

  @Field
  var minSilenceDuration: Float = 0.25F

  @Field
  var minSpeechDuration: Float = 0.25F

  @Field
  var windowSize: Int = 512

  @Field
  var maxSpeechDuration: Float = 5.0F

  @Field
  var numThreads: Int = 1

  @Field
  var provider: String = "cpu"
}

class SherpaVadModule : Module() {
  private val detectors = ConcurrentHashMap<String, Vad>()

  override fun definition() = ModuleDefinition {
    Name("SherpaVad")

    AsyncFunction("initialize") { id: String, options: VadOptions ->
      check(!detectors.containsKey(id)) { "VAD instance already exists: $id" }
      val config = VadModelConfig(
        sileroVadModelConfig = SileroVadModelConfig(
          model = options.modelPath,
          threshold = options.threshold,
          minSilenceDuration = options.minSilenceDuration,
          minSpeechDuration = options.minSpeechDuration,
          windowSize = options.windowSize,
          maxSpeechDuration = options.maxSpeechDuration,
        ),
        sampleRate = options.sampleRate,
        numThreads = options.numThreads,
        provider = options.provider,
      )
      detectors[id] = Vad(assetManager = null, config = config)
    }

    AsyncFunction("acceptWaveform") { id: String, samples: FloatArray ->
      val vad = requireDetector(id)
      vad.acceptWaveform(samples)
      drain(vad)
    }

    AsyncFunction("flush") { id: String ->
      val vad = requireDetector(id)
      vad.flush()
      drain(vad)
    }

    AsyncFunction("destroy") { id: String ->
      detectors.remove(id)?.release()
    }

    OnDestroy {
      detectors.values.forEach(Vad::release)
      detectors.clear()
    }
  }

  private fun requireDetector(id: String): Vad =
    detectors[id] ?: error("Unknown VAD instance: $id")

  private fun drain(vad: Vad): List<Map<String, Any>> {
    val segments = mutableListOf<Map<String, Any>>()
    while (!vad.empty()) {
      val segment = vad.front()
      segments += mapOf(
        "start" to segment.start,
        "samples" to segment.samples,
      )
      vad.pop()
    }
    return segments
  }
}
