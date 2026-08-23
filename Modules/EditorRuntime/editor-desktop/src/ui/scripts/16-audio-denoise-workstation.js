function colorControls() {
        const groups = [
          ["曝光与对比", [
            ["exposure", "曝光", -100, 100], ["contrast", "对比度", -100, 100],
            ["pivot", "对比枢轴", -100, 100], ["fade", "褪色", 0, 100],
          ]],
          ["色调范围", [
            ["lift", "Lift 暗部", -100, 100], ["gamma", "Gamma 中间调", -100, 100],
            ["gain", "Gain 亮部", -100, 100], ["shadows", "阴影", -100, 100],
            ["highlights", "高光", -100, 100], ["blacks", "黑场", -100, 100],
            ["whites", "白场", -100, 100],
          ]],
          ["白平衡与色彩", [
            ["temperature", "色温", -100, 100], ["tint", "色偏", -100, 100],
            ["saturation", "饱和度", -100, 100], ["vibrance", "自然饱和度", -100, 100],
            ["hue", "色相", -100, 100],
          ]],
          ["细节与镜头", [
            ["midtoneDetail", "中间调细节", -100, 100], ["sharpness", "锐化", 0, 100],
            ["vignette", "暗角", 0, 100],
          ]],
        ];
        $("colorControls").innerHTML = groups
          .map(([title, defs]) =>
            `<section class="grade-control-group"><div class="grade-control-title">${title}</div><div class="grade-control-grid">${defs.map(
              ([id, label, min, max]) =>
                `<div class="field"><div class="fieldhead"><span>${label}</span><output id="${id}Out">${Number(state.color[id] || 0)}</output></div><input class="range colorrange" data-color="${id}" data-reset-value="0" type="range" min="${min}" max="${max}" value="${Number(state.color[id] || 0)}"></div>`,
            ).join("")}</div></section>`,
          )
          .join("");
        installRangeSteppers($("colorControls"));
      }
      function beautyControls() {
        const defs = [
          ["smoothing", "肤质平滑", 0, 100],
          ["blemish", "色斑细纹弱化", 0, 100],
          ["texture", "皮肤质感恢复", 0, 100],
          ["whitening", "自然美白", 0, 100],
          ["brighten", "肤色提亮", -50, 100],
          ["warmth", "肤色冷暖", -50, 50],
          ["rosy", "自然红润", -50, 100],
        ];
        $("beautyControls").innerHTML = defs
          .map(
            ([id, label, min, max]) =>
              `<div class="field"><div class="fieldhead"><span>${label}</span><output id="beauty-${id}-out">${state.beauty[id]}</output></div><input class="range" data-beauty="${id}" data-reset-value="0" type="range" min="${min}" max="${max}" value="${state.beauty[id]}"></div>`,
          )
          .join("");
        installRangeSteppers($("beautyControls"));
      }
      function syncDenoiseProfessionalControls() {
        state.denoise = normalizeDenoiseSettings(state.denoise);
        const config = state.denoise;
        $("denoisePreset").value = config.preset;
        $("denoiseHumEnabled").checked = config.humEnabled !== false;
        $("denoiseHumFrequency").value = config.humFrequency || "auto";
        const controls = {
          denoiseHumDepth: ["humDepth", "denoiseHumDepthOut"],
          denoiseWind: ["wind", "denoiseWindOut"],
          denoiseEnvironment: ["environment", "denoiseEnvironmentOut"],
          denoiseNeural: ["neural", "denoiseNeuralOut"],
          denoiseInsect: ["insect", "denoiseInsectOut"],
          denoiseResidual: ["residual", "denoiseResidualOut"],
          denoiseVoiceRestore: ["voiceRestore", "denoiseVoiceRestoreOut"],
        };
        for (const [id, [key, outputId]] of Object.entries(controls)) {
          const percent = Math.round(Number(config[key] || 0) * 100);
          $(id).value = percent;
          $(outputId).textContent = `${percent}%`;
        }
        const professional = ["studio-chain", "professional", "pro"].includes(config.mode);
        $("denoiseProfessionalControls").classList.toggle("disabled", !professional);
        $("denoisePreset").disabled = !professional;
        if (config.humFrequency === "auto") {
          $("denoiseAnalysisState").textContent = config.detectedHumFrequency
            ? `已检测到 ${config.detectedHumFrequency} Hz 工频嗡声；De-Hum 会处理基频与 ${config.humHarmonics} 组谐波。`
            : "尚未可靠检测到 50/60 Hz 工频嗡声；试听或应用整轨时会自动检测，不会强行陷波。";
        } else {
          $("denoiseAnalysisState").textContent = `已手动指定 ${config.humFrequency} Hz De-Hum；将处理基频与 ${config.humHarmonics} 组谐波。`;
        }
      }
      function syncAudioControls() {
        syncDenoiseProfessionalControls();
        $("audioSpeed").value = Math.round(state.audio.speed * 100);
        $("speedOut").textContent = `${state.audio.speed.toFixed(2)}×`;
        $("audioVolume").value = Math.round(state.audio.volume * 100);
        $("volumeOut").textContent = `${Math.round(state.audio.volume * 100)}%`;
        $("audioPan").value = Math.round(state.audio.pan * 100);
        $("panOut").textContent =
          Math.abs(state.audio.pan) < 0.01
            ? "居中"
            : state.audio.pan < 0
              ? `左 ${Math.round(-state.audio.pan * 100)}`
              : `右 ${Math.round(state.audio.pan * 100)}`;
        $("audioBass").value = state.audio.bass;
        $("bassOut").textContent = `${state.audio.bass} dB`;
        $("audioTreble").value = state.audio.treble;
        $("trebleOut").textContent = `${state.audio.treble} dB`;
        $("audioCompressor").value = Math.round(state.audio.compressor * 100);
        $("compressorOut").textContent =
          `${Math.round(state.audio.compressor * 100)}%`;
        $("audioLimiter").checked = state.audio.limiter !== false;
        $("audioNormalize").checked = !!state.audio.normalize;
        $("audioPresence").value = state.audio.presence || 0;
        $("presenceOut").textContent = state.audio.presence || 0;
        $("audioDeesser").value = state.audio.deesser || 0;
        $("deesserOut").textContent = state.audio.deesser || 0;
        $("audioVoiceEnhance").value = state.audio.voiceEnhance || 0;
        $("voiceEnhanceOut").textContent = state.audio.voiceEnhance || 0;
        $("audioLowCut").value = state.audio.lowCut || 60;
        $("audioHighCut").value = state.audio.highCut || 16500;
        $("audioChannelMode").value = state.audio.channelMode || "original";
        $("denoiseMode").value = state.denoise.mode || "ai-isolation";
        $("denoiseStrength").value = Math.round(
          (state.denoise.strength ?? 0.85) * 100,
        );
        $("denoiseOut").textContent =
          `${Math.round((state.denoise.strength ?? 0.85) * 100)}%`;
        const hasDenoised = Boolean(state.denoisedAudio);
        if ($("revertDenoisedTrack")) {
          $("revertDenoisedTrack").style.display = hasDenoised ? "inline-flex" : "none";
        }
        if (hasDenoised) {
          const modeLabel =
            state.denoisedAudio.mode === "audio-fx-rack"
              ? "高级音频修复效果架"
              : ["studio-chain", "professional", "pro"].includes(state.denoisedAudio.mode)
              ? "专业多级降噪"
              : state.denoisedAudio.mode === "uvr5-master" || state.denoisedAudio.mode === "uvr5"
              ? "录音棚人声净化（RNNoise/频谱）"
              : state.denoisedAudio.mode === "ai-isolation"
                ? "达芬奇级 AI 语音隔离"
                : state.denoisedAudio.mode === "dereverb"
                  ? "房间回声抑制（频谱）"
                  : state.denoisedAudio.mode === "gentle"
                    ? "温和人声去噪"
                    : "强力去底噪";
          $("denoiseApplyState").textContent =
            `已应用「${modeLabel}」全轨缓存；时间线播放与导出均已生效。`;
        } else {
          $("denoiseApplyState").textContent =
            "导出时会自动应用当前降噪参数。";
        }
        const clipSettings = audioSettingsFor(
          state.selected.type,
          state.selected.id,
          false,
        );
        const clipControls = [
          "clipVolume",
          "clipPan",
          "clipFadeIn",
          "clipFadeOut",
          "clipMute",
        ];
        for (const id of clipControls) $(id).disabled = !clipSettings;
        $("clipAudioSection").classList.toggle("disabled", !clipSettings);
        $("clipAudioHint").textContent = clipSettings
          ? "只影响当前选中的片段；也可直接拖动波形上的黄色音量线。"
          : "选择一个主音频或音频素材片段后可单独调节。";
        if (clipSettings) {
          const volume = clipSettings.muted ? 0 : Number(clipSettings.volume ?? 1);
          const pan = Number(clipSettings.pan || 0);
          $("clipVolume").value = Math.round(volume * 100);
          $("clipVolumeOut").textContent = `${Math.round(volume * 100)}%`;
          $("clipPan").value = Math.round(pan * 100);
          $("clipPanOut").textContent =
            Math.abs(pan) < 0.01
              ? "居中"
              : pan < 0
                ? `左 ${Math.round(-pan * 100)}`
                : `右 ${Math.round(pan * 100)}`;
          $("clipFadeIn").value = Number(clipSettings.fadeIn || 0).toFixed(1);
          $("clipFadeOut").value = Number(clipSettings.fadeOut || 0).toFixed(1);
          $("clipMute").checked = !!clipSettings.muted;
        }
        renderAudioFxRack();
      }
      const syncAudioInspectors = syncAudioControls;
      window.syncAudioInspectors = syncAudioControls;
      async function ensureDemucsEngine(callback) {
        if (state.denoise.mode !== "demucs") {
          return callback();
        }
        const hasDemucs = await nativeCall("hasDemucsEngine").catch(() => false);
        if (hasDemucs) {
          return callback();
        }
        askConfirm(
          "未检测到可执行的 Meta Demucs 本地引擎。\n\n继续后将明确使用内置 RNNoise/频谱稳定降噪，不会把模拟安装当成 Demucs。\n\n如需真正的 Demucs，请先配置 QUICKCUT_DEMUCS_BIN 指向可运行的 demucs 程序。",
          () => {
            $("denoiseApplyState").textContent = "未找到 Demucs，当前使用内置 FFmpeg 稳定降噪回退。";
            callback();
          },
          "使用稳定回退",
        );
      }
      async function analyzeDenoiseNoise() {
        if (!state.video) {
          toast("请先导入视频");
          return;
        }
        const button = $("analyzeDenoiseNoise");
        button.disabled = true;
        button.textContent = "分析中…";
        $("denoiseAnalysisState").textContent = "正在分析播放头附近最多 10 秒音频的 50/60 Hz 工频与谐波…";
        try {
          const profile = await nativeCall("analyzeNoiseProfile", {
            path: state.video.path,
            time: Math.max(0, timelineToSource(state.currentTime) - 2),
            duration: 10,
          });
          state.denoise.detectedHumFrequency = Number(profile.humFrequency || 0);
          state.denoise.humFrequency = "auto";
          if (profile.humFrequency) {
            state.denoise.humEnabled = true;
            $("denoiseAnalysisState").textContent =
              `${profile.message} 置信度 ${Math.round(Number(profile.confidence || 0) * 100)}%，分析 ${profile.sampleSeconds} 秒。`;
            toast(`检测到 ${profile.humFrequency} Hz 电流嗡声`);
          } else {
            $("denoiseAnalysisState").textContent =
              `${profile.message} 50 Hz 得分 ${profile.score50Db} dB，60 Hz 得分 ${profile.score60Db} dB。`;
            toast("未检测到可靠的 50/60 Hz 工频嗡声");
          }
          state.denoisedAudio = null;
          syncDenoiseProfessionalControls();
          syncPreviewAudio();
          queueAutosave();
        } catch (error) {
          $("denoiseAnalysisState").textContent = error.message;
          toast(error.message);
        } finally {
          button.disabled = false;
          button.textContent = "分析";
        }
      }
      async function previewDenoise() {
        if (!state.video) {
          toast("请先导入视频");
          return;
        }
        ensureDemucsEngine(async () => {
          const btn = $("previewDenoise");
          btn.disabled = true;
          btn.textContent = "生成中…";
          try {
            const result = await nativeCall("denoisePreview", {
              path: state.video.path,
              time: timelineToSource(state.currentTime),
              mode: state.denoise.mode || "ai-isolation",
              strength: state.denoise.strength ?? 0.85,
              config: { ...state.denoise },
            });
            $("denoiseCompare").src = result.url;
            $("denoiseCompare").style.display = "block";
            $("denoiseCompare").currentTime = 2;
            $("video").muted = true;
            $("denoiseCompare").onended = () => syncPreviewAudio();
            await $("denoiseCompare").play();
          } catch (e) {
            toast(e.message);
          } finally {
            btn.disabled = false;
            btn.textContent = "试听当前片段";
          }
        });
      }
      async function applyDenoiseToTrack() {
        if (!state.video) {
          toast("请先导入视频");
          return;
        }
        ensureDemucsEngine(async () => {
          const button = $("applyDenoiseTrack");
          button.disabled = true;
          button.textContent = "正在处理整轨…";
          $("denoiseApplyState").textContent = "正在按 De-Hum → 风噪 → 环境声 → RNNoise → 残留 → EQ 的顺序生成整轨降噪…";
          try {
            const media = await nativeCall("applyDenoiseTrack", {
              projectId: state.projectId,
              path: state.video.path,
              mode: state.denoise.mode || "ai-isolation",
              strength: state.denoise.strength ?? 0.85,
              config: { ...state.denoise },
            });
            state.denoisedAudio = {
              ...media,
              sourcePath: state.video.path,
              mode: state.denoise.mode || "ai-isolation",
              strength: state.denoise.strength ?? 0.85,
              configSignature: denoiseSettingsSignature(),
            };
            state.denoiseEnabled = true;
            syncAudioControls();
            syncPreviewAudio();
            queueAutosave();
            toast("AI 降噪已成功应用到整条音轨");
          } catch (error) {
            $("denoiseApplyState").textContent = error.message;
            toast(error.message);
          } finally {
            button.disabled = false;
            button.textContent = "应用整条音轨";
          }
        });
      }
      function revertDenoisedTrack() {
        if (!state.denoisedAudio) return;
        state.denoisedAudio = null;
        state.denoiseEnabled = false;
        syncAudioControls();
        syncPreviewAudio();
        queueAutosave();
        toast("已还原为原始音频");
      }
      function compactWaveform(value, limit = 180000) {
        if (!Array.isArray(value) || !value.length) return [];
        if (value.length <= limit) return value;
        const result = [];
        const bucket = value.length / limit;
        for (let index = 0; index < limit; index += 1) {
          const start = Math.floor(index * bucket);
          const end = Math.max(start + 1, Math.floor((index + 1) * bucket));
          let low = 0,
            high = 0;
          for (let point = start; point < end && point < value.length; point += 1) {
            low = Math.min(low, Number(value[point]?.[0] || 0));
            high = Math.max(high, Number(value[point]?.[1] || 0));
          }
          result.push([low, high]);
        }
        return result;
      }
      