function persistedMediaItem(item, preserveWaveform = false) {
        if (!item) return item;
        const copy = { ...item };
        if (preserveWaveform) copy.waveform = compactWaveform(copy.waveform);
        else delete copy.waveform;
        delete copy.analysisJobId;
        return copy;
      }
      function projectData() {
        return {
          projectId: state.projectId,
          projectName: state.projectName,
          projectPath: state.projectPath,
          video: persistedMediaItem(state.video),
          videoLayers: state.videoLayers.map((item) =>
            persistedMediaItem(item, true),
          ),
          libraryAssets: state.libraryAssets.map(persistedMediaItem),
          hiddenLibraryPaths: state.hiddenLibraryPaths,
          audioAssets: state.audioAssets.map((item) =>
            persistedMediaItem(item, true),
          ),
          images: state.images,
          titles: state.titles,
          captions: state.captions,
          auxSubtitles: state.auxSubtitles,
          reviewCaptions: state.reviewCaptions,
          issues: state.issues,
          matchIssues: state.matchIssues,
          alignmentOperations: state.alignmentOperations,
          alignmentDuration: state.alignmentDuration,
          removals: state.removals,
          manualCuts: state.manualCuts,
          audioMutes: state.audioMutes,
          audioCuts: state.audioCuts,
          mainAudioRemovals: state.mainAudioRemovals,
          mainAudioManualCuts: state.mainAudioManualCuts,
          waveform: compactWaveform(state.waveform),
          sourceDuration: state.sourceDuration,
          duration: state.duration,
          timelineDuration: state.timelineDuration,
          mainTimelineOffset: state.mainTimelineOffset,
          mainAudioTimelineOffset: state.mainAudioTimelineOffset,
          mainVideoClipOffsets: state.mainVideoClipOffsets,
          mainAudioClipOffsets: state.mainAudioClipOffsets,
          mainVideoClipSettings: state.mainVideoClipSettings,
          currentTime: state.currentTime,
          zoom: state.zoom,
          ratio: state.ratio,
          width: state.width,
          height: state.height,
          videoTransform: state.videoTransform,
          captionTransform: state.captionTransform,
          trackOrder: state.trackOrder,
          trackDefinitions: state.trackDefinitions,
          mainVideoTrackMap: state.mainVideoTrackMap,
          mainAudioTrackMap: state.mainAudioTrackMap,
          trackVisibility: state.trackVisibility,
          trackLocks: state.trackLocks,
          trackHeights: state.trackHeights,
          trackSolo: state.trackSolo,
          trackMute: state.trackMute,
          trackAutoSelect: state.trackAutoSelect,
          avLinked: state.avLinked,
          snapping: state.snapping,
          selectionFollowsPlayhead: state.selectionFollowsPlayhead,
          timelineMarkers: state.timelineMarkers,
          captionLines: state.captionLines,
          captionStyle: state.captionStyle,
          color: state.color,
          filterLook: state.filterLook,
          lut: state.lut,
          denoise: state.denoise,
          denoiseEnabled: state.denoiseEnabled,
          denoisedAudio: persistedMediaItem(state.denoisedAudio),
          audioFxRack: normalizeAudioFxRack(state.audioFxRack),
          audioFxBypass: !!state.audioFxBypass,
          beauty: state.beauty,
          audio: state.audio,
          audioProcessingEnabled: state.audioProcessingEnabled,
          mainAudioClipSettings: state.mainAudioClipSettings,
          projectCoverPath: state.projectCoverPath,
          lastPolishPlan: state.lastPolishPlan || window.__lastPolishPlan || null,
          pauseGapPlan: state.pauseGapPlan || window.__pauseGapPlan || null,
          ignoredPolishIds: Array.from(window.__ignoredPolishIds || state.ignoredPolishIds || []),
          layout: state.layout,
          script: $("scriptText").value,
        };
      }
      async function saveProject() {
        await flushAutoSave();
        toast("工程已保存");
      }
      async function openProject() {
        try {
          const opened = unwrap(await window.native.openProject());
          if (!opened) return;
          const d = opened.data;
          Object.assign(state, d, {
            videoLayers: d.videoLayers || [],
            images: d.images || [],
            titles: d.titles || [],
            captions: d.captions || [],
            captionLines: normalizeCaptionLineMode(d.captionLines ?? d.captionStyle?.captionLines ?? 1),
            reviewCaptions: d.reviewCaptions || [],
            issues: d.issues || [],
            removals: d.removals || [],
            manualCuts: d.manualCuts || [],
            audioMutes: d.audioMutes || [],
            audioCuts: d.audioCuts || [],
            trackOrder: d.trackOrder || [...defaultTrackOrder],
            trackDefinitions: d.trackDefinitions || {},
            trackVisibility: {
              ...Object.fromEntries(
                defaultTrackOrder.map((key) => [key, true]),
              ),
              ...(d.trackVisibility || {}),
            },
            trackLocks: d.trackLocks || {},
            captionTransform: d.captionTransform || {
              x: 0,
              y: Math.round((d.height || 1920) * 0.28),
              scale: 1,
              width: Math.round((d.width || 1080) * 0.8),
            },
            color: {
              exposure: 0, contrast: 0, pivot: 0, lift: 0, gamma: 0, gain: 0,
              shadows: 0, highlights: 0, blacks: 0, whites: 0,
              saturation: 0, temperature: 0, tint: 0, vibrance: 0, hue: 0,
              midtoneDetail: 0, sharpness: 0, fade: 0, vignette: 0,
              ...(d.color || {}),
            },
            beauty: {
              smoothing: 0, blemish: 0, texture: 0, whitening: 0,
              brighten: 0, warmth: 0, rosy: 0,
              ...(d.beauty || {}),
            },
            denoise: normalizeDenoiseSettings(d.denoise),
            audioFxRack: normalizeAudioFxRack(d.audioFxRack),
            audioFxBypass: !!d.audioFxBypass,
            audioFxScope: "track",
            projectPath: opened.projectPath,
            selected: { type: "video", id: "main" },
            selectedItems: [],
            mainAudioClipSettings: d.mainAudioClipSettings || {},
            mainVideoClipSettings: d.mainVideoClipSettings || {},
            lastPolishPlan: d.lastPolishPlan || null,
            pauseGapPlan: d.pauseGapPlan || null,
            ignoredPolishIds: Array.isArray(d.ignoredPolishIds) ? d.ignoredPolishIds : [],
            undo: [],
          });
          window.__lastPolishPlan = state.lastPolishPlan;
          window.__pauseGapPlan = state.pauseGapPlan
            ? (state.pauseGapPlan || []).map(g => ({ ...g }))
            : (state.lastPolishPlan?.pauseGaps || []).map(g => ({ ...g }));
          window.__ignoredPolishIds = new Set(state.ignoredPolishIds);
          if (state.lastPolishPlan && $("lastPolishReport")) {
            $("lastPolishReport").disabled = false;
          }
          if (state.lastPolishPlan) {
            const summary =
              `自动切 ${state.lastPolishPlan.autoApplied || 0} 处重录/废读，口语并进 ${(state.lastPolishPlan.mergedSpoken || []).length} 条，清掉 ${(state.lastPolishPlan.strippedNotes || []).length} 处备注，${(state.lastPolishPlan.scriptureLock || []).length} 处经文锁定，${(state.lastPolishPlan.missing || []).length} 处缺读待补${(state.lastPolishPlan.leftover || []).length ? `，${state.lastPolishPlan.leftover.length} 处待确认` : ""}。气口建议切 ${state.lastPolishPlan.pauseSuggestCut || 0} 处。`;
            if ($("globalPolishSummarySidebar")) $("globalPolishSummarySidebar").textContent = summary;
            if ($("globalPolishSummary")) $("globalPolishSummary").textContent = summary;
            renderPolishSidebarList();
          }
          ensureDynamicTracks();
          if (d.video?.path) {
            const v = unwrap(await window.native.addVideoPath(d.video.path));
            state.video = { ...d.video, ...v };
            $("video").src = state.video.url;
            $("stage").classList.remove("empty");
          }
          for (const image of state.images) {
            const a = unwrap(await window.native.addImagePath(image.path));
            image.url = a.url;
            const imgTester = new Image();
            imgTester.src = a.url;
            imgTester.onload = () => {
              image.sourceWidth = imgTester.naturalWidth;
              image.sourceHeight = imgTester.naturalHeight;
              renderPreviewObjects();
            };
          }
          $("scriptText").value = d.script || "";
          setRatio(d.ratio || "9:16");
          if (state.captions.length) {
            state.captions = await applyCaptionGrouping(state.captions, state.captionLines);
          }
          renderAll();
          toast("工程已打开");
        } catch (e) {
          toast(e.message);
        }
      }
      let cachedExportHardware = null;
      function hardwareExportLabel() {
        if (selectedExportDevice() === "cpu") return "⚙️ CPU 软件编码导出";
        const vendor = cachedExportHardware?.vendor;
        if (vendor === "nvidia") return "🚀 NVIDIA 显卡加速导出 (NVENC)";
        if (vendor === "intel") return "🚀 Intel 显卡加速导出 (QSV)";
        if (vendor === "amd") return "🚀 AMD 显卡加速导出 (AMF)";
        if (vendor === "apple") return "🚀 Apple 硬件加速 (VideoToolbox)";
        if (vendor === "software") return "⚙️ 软件编码 (未检测到兼容显卡)";
        return cachedExportHardware?.label
          ? `🚀 ${cachedExportHardware.label}`
          : "自动检测硬件加速";
      }
      function selectedExportDevice() {
        return $("exportUseCpu")?.checked && !$("exportUseGpu")?.checked ? "cpu" : "gpu";
      }
      function applyExportDevice(device) {
        const gpu = String(device || "gpu").toLowerCase() !== "cpu";
        if ($("exportUseGpu")) $("exportUseGpu").checked = gpu;
        if ($("exportUseCpu")) $("exportUseCpu").checked = !gpu;
      }
      function persistExportDevice() {
        try {
          localStorage.setItem("quickcut_export_device", selectedExportDevice());
        } catch {}
      }
      function restoreExportDevice() {
        let stored = "gpu";
        try {
          stored = localStorage.getItem("quickcut_export_device") || "gpu";
        } catch {}
        applyExportDevice(stored);
      }
      function renderExportHardwareStatus() {
        const status = $("exportHardwareStatus");
        if (!status) return;
        if (!cachedExportHardware) {
          status.textContent = "正在检测可用硬件编码器…";
          return;
        }
        const hardware = cachedExportHardware;
        status.textContent = hardware.vendor === "software"
          ? "未通过显卡编码实测，将安全使用 CPU。可更新显卡驱动后点“重新检测显卡”。"
          : `已通过实际编码测试：${hardware.label || hardware.vendor} · ${hardware.h264 || "自动编码器"}`;
      }
      async function loadExportHardware(force = false) {
        if (cachedExportHardware && !force) return cachedExportHardware;
        if (force) cachedExportHardware = null;
        renderExportHardwareStatus();
        try {
          cachedExportHardware = await nativeCall(force ? "refreshExportHardware" : "exportHardware");
        } catch {
          cachedExportHardware = { vendor: "unknown", label: "自动选择编码器" };
        }
        renderExportHardwareStatus();
        return cachedExportHardware;
      }
      function openExportSettings() {
        if (!state.video) {
          toast("请先导入视频");
          return;
        }
        $("exportName").value =
          `${state.video.name.replace(/\.[^.]+$/, "")}-已剪辑`;
        restoreExportDevice();
        updateExportSummary();
        $("exportSettingsModal").classList.add("on");
        loadExportHardware().then(() => updateExportSummary());
      }
      function exportSettingsDimensions() {
        const resolution = $("exportResolution").value;
        return resolution === "current"
          ? [state.width, state.height]
          : resolution.split("x").map(Number);
      }
      function visualTransformIsDefault(value = {}) {
        return Math.abs(Number(value.x || 0)) < 0.001 &&
          Math.abs(Number(value.y || 0)) < 0.001 &&
          Math.abs(Number(value.scale || 1) - 1) < 0.001 &&
          Math.abs(Number(value.rotation || 0)) < 0.001 &&
          Math.abs(Number(value.opacity ?? 1) - 1) < 0.001 &&
          (value.blendMode || "normal") === "normal";
      }
      function projectCanSmartRemux() {
        const [width, height] = exportSettingsDimensions(),
          fps = selectedExportFps(),
          codec = $("exportCodec").value,
          sourceCodec = String(state.video?.videoCodec || "").toLowerCase(),
          sourceIsWebSafe = /h264|avc|hevc|h265/.test(sourceCodec),
          codecMatches = (codec === "source" && ($("exportFormat").value === "mov" || sourceIsWebSafe)) || (codec === "hevc"
            ? /hevc|h265/.test(sourceCodec)
            : /h264|avc/.test(sourceCodec));
        return ["mp4", "mov"].includes($("exportFormat").value) &&
          codecMatches && width === Number(state.video?.displayWidth || state.video?.width || 0) &&
          height === Number(state.video?.displayHeight || state.video?.height || 0) &&
          Math.abs(fps - Number(state.video?.frameRate || fps)) < 0.1 &&
          !state.removals.length && !state.manualCuts.length &&
          !state.audioMutes.length && !state.audioProcessingEnabled &&
          !state.videoLayers.length && !state.images.length && !state.titles.length &&
          !state.captions.length && !state.audioAssets.length &&
          visualTransformIsDefault(state.videoTransform) &&
          Object.values(state.mainVideoClipSettings || {}).every(visualTransformIsDefault) &&
          Object.values(state.color || {}).every((value) => Math.abs(Number(value || 0)) < 0.001) &&
          Object.values(state.beauty || {}).every((value) => Math.abs(Number(value || 0)) < 0.001) &&
          Math.abs(Number(state.audio?.speed || 1) - 1) < 0.001 &&
          Math.abs(Number(state.audio?.volume || 1) - 1) < 0.001 &&
          !state.denoiseEnabled;
      }
      function updateExportSummary() {
        if (!state.video) return;
        const duration = exportContentEnd($("exportFormat").value === "mp3");
        $("exportDurationText").textContent = formatTime(duration, false);
        const smartCopy = projectCanSmartRemux();
        $("exportModeText").textContent = smartCopy
          ? "极速原码流直出（零损失）"
          : hardwareExportLabel();
        if (smartCopy) {
          const sourceDuration = Math.max(0.04, Number(state.video?.duration || state.sourceDuration || duration)),
            bytes = Number(state.video?.size || 0) * Math.min(1, duration / sourceDuration);
          $("exportSizeText").textContent = formatFileSize(bytes);
        } else {
          const [width, height] = exportSettingsDimensions(),
            bitrateValue = $("exportBitrate").value,
            bitrate = bitrateValue === "recommended"
              ? recommendedExportBitrate(width, height, selectedExportFps())
              : bitrateValue,
            videoMbps = $("exportFormat").value === "mp3"
              ? 0
              : Number.parseFloat(String(bitrate)) || 0,
            audioMbps = $("exportFormat").value === "mp3" ? 0.192 : 0.192,
            bytes = duration * (videoMbps + audioMbps) * 1_000_000 / 8;
          $("exportSizeText").textContent = `约 ${formatFileSize(bytes)}`;
        }
      }
      function formatFileSize(bytes) {
        const value = Math.max(0, Number(bytes || 0));
        if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)} GB`;
        if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} MB`;
        if (value >= 1_000) return `${(value / 1_000).toFixed(1)} KB`;
        return `${Math.round(value)} B`;
      }
      function selectedExportFps() {
        const selected = $("exportFps").value;
        if (selected !== "source") return Number(selected) || 30;
        return clamp(Math.round(Number(state.video?.frameRate || 30)), 1, 120);
      }
      function recommendedExportBitrate(width, height, fps) {
        const pixels = Number(width || 0) * Number(height || 0),
          highFrameRate = Number(fps || 30) > 30;
        let base = pixels >= 7_000_000
          ? (highFrameRate ? 70 : 50)
          : pixels >= 3_000_000
            ? (highFrameRate ? 36 : 26)
            : pixels >= 1_500_000
              ? (highFrameRate ? 22 : 16)
              : (highFrameRate ? 14 : 10);
        const sourceMbps = Number(state.video?.size || 0) * 8 /
          Math.max(1, Number(state.video?.duration || state.sourceDuration || 1)) / 1_000_000;
        const sourcePixels = Math.max(
          1,
          Number(state.video?.displayWidth || state.video?.width || width) *
            Number(state.video?.displayHeight || state.video?.height || height),
        );
        const scaledSource = sourceMbps * Math.min(2.2, pixels / sourcePixels) *
          (Number(fps || 30) / Math.max(1, Number(state.video?.frameRate || fps || 30)));
        const quality = $("exportQuality")?.value || "balanced",
          multiplier = quality === "maximum" ? 1.35 : quality === "fast" ? 0.72 : 1;
        const chosenCodec = $("exportCodec").value === "source"
          ? (/hevc|h265/.test(String(state.video?.videoCodec || "").toLowerCase()) ? "hevc" : "h264")
          : $("exportCodec").value;
        base = Math.max(
          base,
          scaledSource * (chosenCodec === "hevc" ? 0.78 : 1.05),
        );
        return `${Math.max(8, Math.min(100, Math.ceil(base * multiplier)))}M`;
      }
      function blockingScriptureOnTimeline() {
        return (state.issues || []).filter((issue) => {
          if (!(issue.scripture || issue.strict)) return false;
          if (issue.suppressReview) return false;
          return (
            issue.confirmedError === true ||
            issue.type === "missing" ||
            issue.type === "mismatch"
          );
        });
      }
      function resolveCaptionPayload() {
        return {
          projectName: state.projectName || "快剪导出",
          width: state.width,
          height: state.height,
          fps: state.video?.frameRate || 30,
          captions: (state.captions || []).map((caption) => ({
            text: caption.text,
            start: caption.start,
            end: caption.end,
            words: Array.isArray(caption.words) ? caption.words : [],
            width: caption.width || state.captionTransform?.width,
            scale: caption.scale || state.captionTransform?.scale,
            x: state.captionTransform?.x,
            y: state.captionTransform?.y,
            style: caption.style,
          })),
          captionStyle: { ...state.captionStyle, captionLines: state.captionLines },
          captionTransform: state.captionTransform,
        };
      }
      function setSendResolveProgress(percent, summary, status, waiting = false, logTail = "") {
        $("sendResolveBar").style.width = `${Math.max(0, Math.min(100, Number(percent) || 0))}%`;
        if (summary) $("sendResolveSummary").textContent = summary;
        if (status) $("sendResolveStatus").textContent = status;
        $("sendResolveProgressWrap").classList.toggle("waiting", !!waiting);
        const logBox = $("sendResolveLog");
        if (logTail) {
          logBox.style.display = "block";
          logBox.textContent = logTail;
          logBox.scrollTop = logBox.scrollHeight;
        }
      }
      async function sendCaptionsToResolve() {
        if (!(state.captions || []).some((caption) => String(caption.text || "").trim())) {
          toast("请先做好字幕再发送到达芬奇");
          return;
        }
        const button = $("sendResolve");
        const closeButton = $("closeSendResolve");
        const original = button.textContent;
        const total = (state.captions || []).filter((caption) => String(caption.text || "").trim()).length;
        let pollTimer = 0;
        button.disabled = true;
        closeButton.disabled = true;
        button.textContent = "正在发送…";
        $("sendResolveModal").classList.add("on");
        setSendResolveProgress(8, `准备发送 ${total} 条字幕`, "正在写入任务…", true);
        try {
          await nativeCall("installResolveLink");
          const refreshProgress = async () => {
            try {
              const progress = await nativeCall("resolveSendProgress");
              if (!progress) return;
              if (!progress.listening && progress.phase !== "writing" && progress.phase !== "done") {
                setSendResolveProgress(
                  Math.max(8, Number(progress.percent) || 8),
                  "达芬奇还没开始接收",
                  "请打开工程和时间线，点「工作区 → 脚本 → 快剪」。点过一次后进度会继续走。",
                  true,
                );
                return;
              }
              if (progress.phase === "writing") {
                setSendResolveProgress(
                  Math.max(12, Number(progress.percent) || 12),
                  progress.total
                    ? `已成功 ${progress.done || 0} / ${progress.total}`
                    : "达芬奇正在写入字幕",
                  progress.message || "正在把 Text+ 铺到时间线…",
                  false,
                  progress.logTail,
                );
                return;
              }
              if (progress.phase === "done") {
                setSendResolveProgress(
                  100,
                  `已发送 ${progress.done || total} 条`,
                  progress.message || "达芬奇写入完成",
                  false,
                  progress.logTail,
                );
                return;
              }
              if (progress.phase === "error") {
                setSendResolveProgress(
                  100,
                  "发送失败",
                  progress.message || progress.error || "达芬奇写入失败",
                  false,
                  progress.logTail,
                );
                return;
              }
              setSendResolveProgress(
                Math.max(16, Number(progress.percent) || 16),
                progress.listening ? "达芬奇已连接" : "等待达芬奇",
                progress.message || "等待写入…",
                progress.phase === "waiting" || progress.phase === "idle",
              );
            } catch {
              /* keep last status */
            }
          };
          await refreshProgress();
          pollTimer = window.setInterval(refreshProgress, 250);
          const result = await nativeCall("sendToResolve", resolveCaptionPayload());
          window.clearInterval(pollTimer);
          pollTimer = 0;
          await refreshProgress();
          const extra = result.warning ? `，${result.warning}` : "";
          setSendResolveProgress(100, `已发送 ${result.count} 条字幕`, `已铺到达芬奇当前时间线${extra}`);
          toast(`已发送 ${result.count} 条字幕到达芬奇`);
        } catch (error) {
          if (pollTimer) window.clearInterval(pollTimer);
          let tail = "";
          try {
            tail = (await nativeCall("resolveSendProgress"))?.logTail || "";
          } catch {}
          setSendResolveProgress(100, "发送失败", error.message, false, tail);
          toast(error.message);
        } finally {
          if (pollTimer) window.clearInterval(pollTimer);
          button.disabled = false;
          closeButton.disabled = false;
          button.textContent = original;
        }
      }
      async function exportResolveTimeline() {
        if (!state.video?.path) {
          toast("请先导入视频");
          return;
        }
        try {
          const output = await nativeCall(
            "chooseResolveExport",
            `${state.projectName || "快剪"}-达芬奇.fcpxml`,
          );
          if (!output) {
            toast("已取消导出达芬奇时间线");
            return;
          }
          const result = unwrap(
            await window.native.exportResolveTimeline({
              outputPath: output,
              projectName: state.projectName || "快剪导出",
              inputPath: state.video.path,
              sourceDuration: state.sourceDuration || state.duration,
              width: state.width,
              height: state.height,
              fps: state.video.frameRate || 30,
              audioRate: state.video.audioSampleRate || state.video.sampleRate || 48000,
              audioChannels: state.video.audioChannels || 2,
              clips: mainClips(),
              captions: (state.captions || []).map((caption) => ({
                text: caption.text,
                start: caption.start,
                end: caption.end,
                words: caption.words,
                width: caption.width || state.captionTransform?.width,
                scale: caption.scale || state.captionTransform?.scale,
                x: state.captionTransform?.x,
                y: state.captionTransform?.y,
              })),
              captionStyle: { ...state.captionStyle, captionLines: state.captionLines },
              captionTransform: state.captionTransform,
              removals: state.removals,
              videoLayers: (state.videoLayers || []).map((item) => ({
                path: item.path,
                name: item.name,
                start: item.start,
                end: item.end,
                sourceStart: item.sourceStart || 0,
                x: item.x || 0,
                y: item.y || 0,
                scale: item.scale || 1,
                rotation: item.rotation || 0,
                opacity: item.opacity ?? 1,
              })),
              images: (state.images || []).map((item) => ({
                path: item.path,
                name: item.name,
                start: item.start,
                end: item.end,
                x: item.x || 0,
                y: item.y || 0,
                scale: item.scale || 1,
                rotation: item.rotation || 0,
                opacity: item.opacity ?? 1,
              })),
              titles: (state.titles || []).map((item) => ({
                text: item.text,
                start: item.start,
                end: item.end,
                x: item.x || 0,
                y: item.y || 0,
                width: item.width,
                scale: item.scale || 1,
                style: item.style,
              })),
              audioAssets: (state.audioAssets || []).map((item) => ({
                path: item.path,
                name: item.name,
                start: item.start,
                end: item.end,
                sourceStart: item.sourceStart || 0,
                volume: item.volume ?? 1,
              })),
            }),
          );
          toast(
            `已导出达芬奇时间线 ${result.clipCount} 段。用「文件 → 导入时间线」打开 fcpxml。片头剪掉后会从 00:00:00 起铺，不要从素材时间码起。`,
          );
        } catch (error) {
          toast(error.message);
        }
      }
      async function exportVideo() {
        const blocked = blockingScriptureOnTimeline();
        if (blocked.length) {
          toast(`有 ${blocked.length} 处经文不符或漏读，禁止导出。请按原文重录后再导出。`);
          return;
        }
        const chooseButton = $("exportSettingsConfirm"),
          originalChooseText = chooseButton.textContent;
        try {
          const format = $("exportFormat").value,
            resolution = $("exportResolution").value;
          let width = state.width,
            height = state.height;
          if (resolution !== "current")
            [width, height] = resolution.split("x").map(Number);
          const exportDuration = exportContentEnd(format === "mp3");
          if (exportDuration <= 0.04) {
            toast("没有可见素材可以导出；请检查轨道眼睛开关");
            return;
          }
          const fps = selectedExportFps(),
            bitrateSelection = $("exportBitrate").value,
            bitrate =
              bitrateSelection === "recommended"
                ? recommendedExportBitrate(width, height, fps)
                : bitrateSelection;
          chooseButton.disabled = true;
          chooseButton.textContent = "正在打开保存位置…";
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const picked = await nativeCall(
            "chooseExport",
            `${$("exportName").value || "快剪导出"}.${format}`,
          );
          chooseButton.disabled = false;
          chooseButton.textContent = originalChooseText;
          const output = typeof picked === "string" ? picked : picked?.path;
          if (!output) {
            toast("已取消选择保存位置");
            return;
          }
          if (picked?.autoSaved)
            toast(picked.notice ? `${picked.notice}，已保存到 ${output}` : `已保存到 ${output}`);
          $("exportSettingsModal").classList.remove("on");
          $("exportModal").classList.add("on");
          $("cancelExport").textContent = "取消导出";
          $("exportBar").style.width = "0";
          $("exportStatus").textContent = "正在检查音频修复参数…";
          await ensureAudioFxHumAnalysis(true);
          $("exportStatus").textContent = "正在按预览渲染字幕…";
          let captionRasters = [];
          let captionRasterDirectory = "";
          try {
            const rendered = await rasterizeCaptionsForExport();
            captionRasters = rendered.images || [];
            captionRasterDirectory = rendered.directory || "";
          } catch (error) {
            console.warn("字幕预览渲染失败，回退 ASS", error);
          }
          $("revealExport").style.display = "none";
          let mainAudioPath = "";
          let mainAudioFxPreRendered = false;
          const isDenoiseActive = !!(state.denoiseEnabled && Number(state.denoise?.strength || 0) > 0.01);
          const advancedCacheValid = !!(
            state.denoisedAudio?.includesAudioFx && state.denoisedAudio.path &&
            state.denoisedAudio.sourcePath === state.video?.path &&
            state.denoisedAudio.fxSignature === audioFxSignature() &&
            state.denoisedAudio.configSignature === denoiseSettingsSignature()
          );
          if (advancedCacheValid) {
            mainAudioPath = state.denoisedAudio.path;
            mainAudioFxPreRendered = true;
          } else if (isDenoiseActive && state.video?.path) {
            const currentMode = state.denoise?.mode || "ai-isolation";
            const currentStrength = state.denoise?.strength ?? 0.85;
            const currentConfigSignature = denoiseSettingsSignature();
            const isCacheValid = state.denoisedAudio &&
              state.denoisedAudio.path &&
              state.denoisedAudio.sourcePath === state.video.path &&
              state.denoisedAudio.mode === currentMode &&
              Math.abs(Number(state.denoisedAudio.strength ?? 0.85) - Number(currentStrength)) < 0.01 &&
              state.denoisedAudio.configSignature === currentConfigSignature;

            if (isCacheValid) {
              mainAudioPath = state.denoisedAudio.path;
            } else {
              $("exportStatus").textContent = "正在生成整轨 AI 高清降噪音频…";
              try {
                const media = await nativeCall("applyDenoiseTrack", {
                  projectId: state.projectId,
                  path: state.video.path,
                  mode: currentMode,
                  strength: currentStrength,
                  config: { ...state.denoise },
                });
                state.denoisedAudio = {
                  ...media,
                  sourcePath: state.video.path,
                  mode: currentMode,
                  strength: currentStrength,
                  configSignature: currentConfigSignature,
                };
                state.denoiseEnabled = true;
                mainAudioPath = state.denoisedAudio.path;
                syncAudioControls();
                syncPreviewAudio();
                queueAutosave();
              } catch (err) {
                console.warn("导出前生成降噪缓存失败，回退常规滤镜降噪", err);
              }
            }
          }
          const exportMainVideoClips = mainClips().map((clip) => ({
            ...clip,
            trackId: state.mainVideoTrackMap?.[clip.id] || "video",
            settings: { ...mainVideoSettings(clip) },
          }));
          const exportMainAudioClips = mainAudioClips().map((clip) => {
            const settings = mainAudioSettings(clip) || {};
            const trackId = state.mainAudioTrackMap?.[clip.id] || "audio";
            return {
              ...clip,
              ...settings,
              trackId,
              muted:
                !!settings.muted || !isTrackAudible(trackId),
            };
          });
          const config = {
            inputPath: state.video.path,
            mainAudioPath: mainAudioPath || "",
            outputPath: output,
            format,
            width,
            height,
            fps,
            codec: $("exportCodec").value,
            bitrate,
            colorSpace: $("exportColorSpace").value,
            qualityMode: $("exportQuality").value,
            encoderDevice: selectedExportDevice(),
            removals: state.removals,
            audioMutes: state.audioMutes,
            audioAssets: state.audioAssets.map((x) => ({
              path: x.path,
              start: x.start,
              end: x.end,
              sourceStart: x.sourceStart || 0,
              volume: x.volume ?? 1,
              pan: x.pan || 0,
              fadeIn: x.fadeIn || 0,
              fadeOut: x.fadeOut || 0,
              muted: !!x.muted,
              fxRack: normalizeAudioFxRack(x.fxRack),
              fxBypass: !!x.fxBypass,
              trackId: x.trackId,
            })),
            videoLayers: state.videoLayers.map((x) => ({
              path: x.path,
              start: x.start,
              end: x.end,
              sourceStart: x.sourceStart || 0,
              x: x.x || 0,
              y: x.y || 0,
              scale: x.scale || 1,
              opacity: x.opacity ?? 1,
              rotation: x.rotation || 0,
              blendMode: x.blendMode || "normal",
              cropTop: Number(x.cropTop || 0),
              cropBottom: Number(x.cropBottom || 0),
              cropLeft: Number(x.cropLeft || 0),
              cropRight: Number(x.cropRight || 0),
              volume: x.volume ?? 1,
              trackId: x.trackId,
            })),
            outputDuration: exportDuration,
            mainTimelineOffset: state.mainTimelineOffset,
            videoTransform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, blendMode: "normal" },
            color: state.color,
            lut: state.lut,
            denoise: {
              ...state.denoise,
              strength: state.denoiseEnabled ? state.denoise.strength : 0,
            },
            audioFxRack: normalizeAudioFxRack(state.audioFxRack),
            audioFxBypass: !!state.audioFxBypass,
            mainAudioFxPreRendered,
            beauty: state.beauty,
            audio: state.audio,
            audioProcessingEnabled: state.audioProcessingEnabled,
            trackOrder: state.trackOrder,
            trackDefinitions: state.trackDefinitions,
            trackVisibility: effectiveTrackVisibility(),
            mainAudioClipSettings: state.mainAudioClipSettings,
            mainVideoClips: exportMainVideoClips,
            mainAudioClips: exportMainAudioClips,
            includeVideo: exportMainVideoClips.some(
              (clip) => state.trackVisibility[clip.trackId] !== false,
            ),
            includeAudio: true,
            captionRasterized: captionRasters.length > 0,
            captionRasterDirectory,
            images: [
              ...state.images
              .filter((x) => state.trackVisibility[x.trackId] !== false)
              .map(
              (x) => ({
                path: x.path,
                start: x.start,
                end: x.end,
                x: x.x,
                y: x.y,
                scale: x.scale,
                sourceWidth: x.sourceWidth,
                sourceHeight: x.sourceHeight,
                opacity: x.opacity,
                rotation: x.rotation || 0,
                blendMode: x.blendMode || "normal",
                cropTop: Number(x.cropTop || 0),
                cropBottom: Number(x.cropBottom || 0),
                cropLeft: Number(x.cropLeft || 0),
                cropRight: Number(x.cropRight || 0),
                trackId: x.trackId,
                enterAnimation: x.enterAnimation || "",
                exitAnimation: x.exitAnimation || "",
                enterDuration: x.enterDuration || 0.45,
                exitDuration: x.exitDuration || 0.45,
              }),
            ),
              ...captionRasters,
            ],
            titles: state.titles.filter(
              (x) => state.trackVisibility[x.trackId] !== false,
            ),
            captions: state.captions
              .filter(
                (x) => state.trackVisibility[x.trackId || "caption"] !== false,
              )
              .map(
              (x) => ({
                ...x,
                x: state.captionTransform.x,
                y: state.captionTransform.y,
                scale: state.captionTransform.scale,
                width: state.captionTransform.width,
                style: { ...state.captionStyle, captionLines: state.captionLines },
              }),
            ),
            quality: "high",
          };
          const { jobId } = await nativeCall("startExport", config);
          state.exportJobId = jobId;
          $("exportSummary").textContent =
            format === "mp3"
              ? `MP3 · ${formatTime(exportDuration, false)} · 人声降噪`
              : `${width}×${height} · ${fps} fps · ${$("exportCodec").selectedOptions[0].textContent} · ${bitrate} · ${$("exportColorSpace").selectedOptions[0].textContent} · ${formatTime(exportDuration, false)}`;
          $("exportBar").parentElement?.classList.add("waiting");
          while (true) {
            await new Promise((r) => setTimeout(r, 200));
            const s = await nativeCall("exportStatus", jobId);
            const elapsed = Math.max(0, Number(s.elapsed || 0));
            const clock = `${Math.floor(elapsed / 60)}:${String(Math.floor(elapsed % 60)).padStart(2, "0")}`;
            $("exportBar").style.width = `${Math.max(2, (s.progress || 0) * 100)}%`;
            $("exportBar").parentElement?.classList.toggle(
              "waiting",
              (s.state === "exporting" || s.state === "preparing") && (s.progress || 0) < 0.18,
            );
            if (s.state === "exporting" || s.state === "preparing") {
              let text =
                s.message ||
                `正在导出 ${Math.round((s.progress || 0) * 100)}%${s.encoderLabel ? ` · ${s.encoderLabel}` : ""}`;
              text = /已用 \d+:\d+/.test(text)
                ? text.replace(/已用 \d+:\d+/, `已用 ${clock}`)
                : `${text} · 已用 ${clock}`;
              $("exportStatus").textContent = text;
            } else {
              $("exportStatus").textContent = s.state;
            }
            if (s.state === "completed") {
              $("exportStatus").textContent = s.message || (s.encoderLabel
                ? `导出完成 · ${s.encoderLabel}`
                : "导出完成");
              $("revealExport").style.display = "inline-block";
              $("cancelExport").textContent = "关闭";
              $("revealExport").onclick = () =>
                window.native.revealFile(s.outputPath);
              state.exportJobId = "";
              break;
            }
            if (s.state === "cancelled") {
              $("exportStatus").textContent = "已取消导出";
              $("cancelExport").textContent = "关闭";
              state.exportJobId = "";
              break;
            }
            if (s.state === "failed") throw new Error(s.error);
          }
        } catch (e) {
          chooseButton.disabled = false;
          chooseButton.textContent = originalChooseText;
          state.exportJobId = "";
          $("cancelExport").textContent = "关闭";
          $("exportStatus").textContent = e.message;
          toast(e.message);
        }
      }
      document.querySelectorAll(".tab[data-side]").forEach(
        (b) =>
          (b.onclick = () => {
            document
              .querySelectorAll(".tab[data-side]")
              .forEach((x) => x.classList.toggle("active", x === b));
            document
              .querySelectorAll(".sidebody>.sidepage")
              .forEach((x) =>
                x.classList.toggle("active", x.id === `side-${b.dataset.side}`),
              );
            document.querySelector(".sidebody")?.classList.toggle("polish-active", b.dataset.side === "polish");
            if (b.dataset.side === "style" || b.dataset.side === "subtitle") {
              if (state.selected.type !== "caption" && state.selected.type !== "text") {
                state.selected = { type: "caption", id: state.captions[0]?.id || "caption-track" };
              }
              document.querySelectorAll(".tab[data-inspect]").forEach((x) => x.classList.toggle("active", x.dataset.inspect === "basic"));
              document.querySelectorAll(".inspectbody>.sidepage").forEach((x) => x.classList.toggle("active", x.id === "inspect-basic"));
              updateInspector();
            }
          }),
      );
      document.querySelectorAll(".tab[data-inspect]").forEach(
        (b) =>
          (b.onclick = () => {
            document
              .querySelectorAll(".tab[data-inspect]")
              .forEach((x) => x.classList.toggle("active", x === b));
            document
              .querySelectorAll(".inspectbody>.sidepage")
              .forEach((x) =>
                x.classList.toggle(
                  "active",
                  x.id === `inspect-${b.dataset.inspect}`,
                ),
              );
          }),
      );
      $("filterGrid").onclick = (event) => {
        const card = event.target.closest("[data-filter-look]");
        if (!card) return;
        snapshot();
        applyFilterLook(card.dataset.filterLook);
      };
      $("filterIntensity").oninput = (event) => {
        const intensity = Number(event.target.value) / 100;
        $("filterIntensityOut").textContent = `${event.target.value}%`;
        if (state.lut) {
          state.lut.intensity = intensity;
          queueAutosave();
          return;
        }
        if (state.filterLook?.id && state.filterLook.id !== "none")
          applyFilterLook(state.filterLook.id, intensity);
      };
      $("importLut").onclick = async () => {
        try {
          const lut = await nativeCall("importLut", { projectId: state.projectId });
          if (!lut) return;
          snapshot();
          state.lut = { ...lut, intensity: Number($("filterIntensity").value) / 100 };
          state.filterLook = { id: "none", intensity: 1, baseColor: null };
          renderFilterPanel();
          if (state.video?.path) {
            const preview = await nativeCall("lutPreview", {
              path: state.video.path,
              time: timelineToSource(state.currentTime),
              lutPath: state.lut.path,
            });
            $("lutPreviewFrame").src = preview.url;
            $("lutPreviewFrame").style.display = "block";
          }
          queueAutosave();
          toast("LUT 已载入；当前帧已预览，导出使用四面体插值");
        } catch (error) { toast(error.message); }
      };
      $("clearFilter").onclick = () => {
        snapshot();
        if (state.filterLook?.baseColor) state.color = { ...state.filterLook.baseColor };
        state.filterLook = { id: "none", intensity: 1, baseColor: null };
        state.lut = null;
        $("lutPreviewFrame").style.display = "none";
        renderFilterPanel();
        applyVideoCss();
        queueAutosave();
      };
      renderFilterPanel();
      $("homeNewProject").onclick = openNewProjectModal;
      $("homeEmptyNew").onclick = openNewProjectModal;
      $("newProjectCancel").onclick = closeNewProjectModal;
      $("newProjectConfirm").onclick = createNewProject;
      $("newProjectModal").onclick = (event) => {
        if (event.target === $("newProjectModal")) closeNewProjectModal();
      };
      $("newProjectName").onkeydown = (event) => {
        if (event.key === "Enter") createNewProject();
      };
      $("confirmCancel").onclick = closeConfirm;
      $("confirmAccept").onclick = async () => {
        const action = confirmAction;
        closeConfirm();
        if (!action) return;
        try {
          await action();
        } catch (error) {
          toast(error.message);
        }
      };
      $("confirmModal").onclick = (event) => {
        if (event.target === $("confirmModal")) closeConfirm();
      };
      $("homeSearch").oninput = () =>
        renderProjectHome(window.__projectItems || []);
      function askDeleteProject(projectId, event) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        const item = (window.__projectItems || []).find((project) => project.id === projectId);
        askConfirm(
          `确定删除工程“${item?.name || "未命名工程"}”？工程会移入可恢复目录。`,
          async () => {
            const cardImg = document.querySelector(
              `[data-project-id="${projectId}"] img`,
            );
            if (cardImg) {
              cardImg.removeAttribute("src");
              cardImg.src = "";
            }
            if (state.projectId === projectId) unloadEditorMedia();
            try {
              await nativeCall("releaseProjectAssets", projectId);
            } catch {}
            await new Promise((resolve) => setTimeout(resolve, 80));
            await nativeCall("deleteProject", projectId);
            if (state.projectId === projectId) {
              resetEditorState();
              state.projectId = "";
            }
            await refreshHome();
            toast("工程已删除");
          },
          "删除工程",
        );
      }
      $("homeProjectGrid").onclick = (event) => {
        const remove = event.target.closest("[data-delete-project]");
        if (remove) {
          askDeleteProject(remove.dataset.deleteProject, event);
          return;
        }
        const card = event.target.closest("[data-project-id]");
        if (card) openProjectById(card.dataset.projectId);
      };
      $("homeProjectGrid").onpointerdown = (event) => {
        const remove = event.target.closest("[data-delete-project]");
        if (!remove) return;
        event.stopPropagation();
      };
      $("backHome").onclick = backToHome;
      $("homeBackup").onclick = async () => {
        try {
          const output = await nativeCall("exportProjectBackup");
          if (output) toast("工程备份已保存");
        } catch (error) {
          toast(error.message);
        }
      };
      $("homeRestore").onclick = async () => {
        try {
          const result = await nativeCall("importProjectBackup");
          if (result) {
            await refreshHome();
            toast(`已恢复 ${result.restored || 0} 个工程`);
          }
        } catch (error) {
          toast(error.message);
        }
      };
      if ($("play"))
        $("play").onclick = () => {
          blurActiveTextField();
          togglePlay();
        };
      if ($("toStart")) $("toStart").onclick = () => seekTimeline(0);
      if ($("toEnd")) $("toEnd").onclick = () => seekTimeline(state.duration);
      if ($("playbackSpeedSelect")) {
        $("playbackSpeedSelect").onchange = (e) => {
          setPlaybackSpeed(Number(e.target.value) || 1.0, true);
        };
      }
      if ($("playbackSpeedBtn")) {
        $("playbackSpeedBtn").onclick = () => {
          stepPlaybackSpeed(1);
        };
      }
      if ($("loopPlayback"))
        $("loopPlayback").onclick = () => {
          state.loopPlayback = !state.loopPlayback;
          $("loopPlayback").classList.toggle("active", state.loopPlayback);
          $("loopPlayback").classList.toggle("primary", state.loopPlayback);
          toast(state.loopPlayback ? "循环播放已开启" : "循环播放已关闭");
        };
      if ($("pauseCut")) $("pauseCut").onclick = runPauseCut;
      $("addTrack").onclick = () => {
        addText();
          document.querySelector('[data-inspect="basic"]')?.click();
          requestAnimationFrame(() => {
            $("objectText")?.focus();
            $("objectText")?.select();
          });
        };
      $("trackMenu").onclick = (event) => {
        if (event.target.closest("[data-add-text]")) {
          $("trackMenu").classList.remove("on");
          addText();
          document.querySelector('[data-inspect="basic"]')?.click();
          requestAnimationFrame(() => {
            $("objectText").focus();
            $("objectText").select();
          });
          return;
        }
        const importer = event.target.closest("[data-import-kind]");
        if (importer) {
          $("trackMenu").classList.remove("on");
          const kind = importer.dataset.importKind;
          if (kind === "video") importVideo();
          if (kind === "audio") importAudio();
          if (kind === "image") importImage();
          if (kind === "subtitle") importSubtitle();
          return;
        }
        const button = event.target.closest("[data-add-track-kind]");
        if (button) {
          snapshot();
          const kind = button.dataset.addTrackKind;
          createDynamicTrack(
            kind,
            `${trackMeta[kind]?.label || "素材"}轨道`,
            kind === "audio" ? "audio" : kind === "caption" ? "caption" : "video",
          );
          $("trackMenu").classList.remove("on");
          renderAll();
          return;
        }
      };
      document.addEventListener("pointerdown", (event) => {
        if (!event.target.closest("#contextMenu")) hideContextMenu();
        if (!event.target.closest("#trackMenu,#addTrack"))
          $("trackMenu").classList.remove("on");
      });
      function addEmptyTrack(kind) {
        snapshot();
        createDynamicTrack(
          kind,
          `${trackMeta[kind]?.label || "素材"}轨道`,
          kind === "audio" ? "audio" : kind === "caption" ? "caption" : "video",
        );
        renderAll();
      }
      $("timelineScroll").addEventListener("contextmenu", (event) => {
        const clip = event.target.closest(".clip[data-type][data-id]");
        if (clip) {
          selectItem(clip.dataset.type, clip.dataset.id, false, false);
          const bounds = $("timelineScroll").getBoundingClientRect();
          seekTimeline(
            clamp(
              ($("timelineScroll").scrollLeft + event.clientX - bounds.left) /
                state.zoom,
              0,
              visibleTimelineDuration(),
            ),
          );
          if (clip.dataset.type === "review" && clip.dataset.cutReview) {
            const reviewId = clip.dataset.cutReview;
            showContextMenu(event, [
              { label: "试听这段", action: () => previewReviewSegment(reviewId) },
              { label: "用识别文字替换错误文稿（Alt+点击）", action: () => replaceReviewWithSpoken(reviewId) },
              { label: "保留，不删除（Ctrl+点击）", action: () => acceptReviewSegment(reviewId) },
              { label: "接受并删除（Shift+点击）", danger: true, action: () => cutReviewSegment(reviewId) },
            ]);
            return;
          }
          showContextMenu(event, [
            { label: "在播放头切割经过的片段", action: () => splitSelected() },
            { label: "删除所选片段", danger: true, action: () => deleteSelected(false) },
            { label: "删除并前移", danger: true, action: () => deleteSelected(true) },
            { label: "合并所选相邻切片", action: () => mergeSelectedClips() },
          ]);
          return;
        }
        const row = event.target.closest(".trackrow[data-track-key]");
        const bounds = $("timelineScroll").getBoundingClientRect();
        const clickTime = clamp(
          ($("timelineScroll").scrollLeft + event.clientX - bounds.left) / state.zoom,
          0,
          visibleTimelineDuration(),
        );
        const trackId = row?.dataset.trackKey || "";
        const gap = trackId
          ? (selectedTimelineGapAt(trackId, clickTime) || findTimelineGap(timelineGapItems(trackId), clickTime))
          : null;
        seekTimeline(clickTime);
        if (gap) {
          showContextMenu(event, [
            {
              label: "波纹删除",
              danger: true,
              action: () => rippleDeleteTimelineGap(trackId, gap),
            },
          ]);
          return;
        }
        showContextMenu(event, [
          { label: "添加文字", action: () => addText() },
          { label: "新增视频轨道", action: () => addEmptyTrack("video") },
          { label: "新增音频轨道", action: () => addEmptyTrack("audio") },
          { label: "新增图片轨道", action: () => addEmptyTrack("image") },
          { label: "新增字幕轨道", action: () => addEmptyTrack("caption") },
          { label: "新增文字轨道", action: () => addEmptyTrack("text") },
        ]);
      });
      $("stage").addEventListener("contextmenu", (event) => {
        const object = currentObject();
        showContextMenu(event, [
          object && { label: "居中", action: () => { object.x = 0; object.y = 0; renderAll(); } },
          object && { label: "适应画布", action: () => { object.x = 0; object.y = 0; object.scale = 1; object.rotation = 0; renderAll(); } },
          state.video?.path && state.selected.type === "video" && { label: "在访达中显示素材", action: () => nativeCall("revealFile", state.video.path) },
          object && { label: "删除所选素材", danger: true, action: () => deleteSelected(false) },
        ]);
      });
      document.addEventListener("contextmenu", (event) => {
        if (event.defaultPrevented) return;
        const editable = event.target.closest("textarea,input[type='text'],input:not([type])");
        if (editable) {
          showContextMenu(event, [
            { label: "全选", action: () => editable.select() },
            { label: "复制", action: () => document.execCommand("copy") },
            { label: "剪切", action: () => document.execCommand("cut") },
            { label: "粘贴", action: async () => {
              const text = await nativeCall("readClipboard");
              editable.setRangeText(text, editable.selectionStart, editable.selectionEnd, "end");
              editable.dispatchEvent(new Event("input", { bubbles: true }));
            } },
            { label: "清空", danger: true, action: () => { editable.value = ""; editable.dispatchEvent(new Event("input", { bubbles: true })); } },
          ]);
          return;
        }
        event.preventDefault();
      });
      let trackHeightDrag = null;
      $("trackLabels").addEventListener("pointerdown", (event) => {
        const grip = event.target.closest("[data-resize-track]");
        if (!grip) return;
        const key = grip.dataset.resizeTrack,
          label = grip.closest(".tracklabel"),
          current = Math.max(40, Number(state.trackHeights?.[key] || label?.offsetHeight || 56));
        beginTimelineGesture();
        trackHeightDrag = {
          pointer: event.pointerId,
          key,
          label,
          startY: event.clientY,
          startHeight: current,
        };
        label?.classList.add("resizing");
        grip.setPointerCapture?.(event.pointerId);
        event.preventDefault();
        event.stopPropagation();
      });
      document.addEventListener("pointermove", (event) => {
        if (!trackHeightDrag || trackHeightDrag.pointer !== event.pointerId) return;
        const height = Math.round(clamp(
          trackHeightDrag.startHeight + event.clientY - trackHeightDrag.startY,
          40,
          220,
        ));
        state.trackHeights ||= {};
        state.trackHeights[trackHeightDrag.key] = height;
        if (trackHeightDrag.label) trackHeightDrag.label.style.height = `${height}px`;
        const row = $("timelineContent").querySelector(
          `.trackrow[data-track-key="${trackHeightDrag.key}"]`,
        );
        if (row) {
          row.style.height = `${height}px`;
          row.querySelectorAll(".clip").forEach((clip) => {
            clip.style.top = "3px";
            clip.style.height = `${Math.max(33, height - 7)}px`;
          });
        }
        event.preventDefault();
      });
      document.addEventListener("pointerup", (event) => {
        if (!trackHeightDrag || trackHeightDrag.pointer !== event.pointerId) return;
        trackHeightDrag.label?.classList.remove("resizing");
        trackHeightDrag = null;
        applyLayout();
        renderTimeline();
        commitTimelineGesture();
      });
      $("trackLabels").addEventListener("dblclick", (event) => {
        const grip = event.target.closest("[data-resize-track]");
        if (!grip) return;
        runTimelineCommand("恢复轨道默认高度", {
          recompute: false,
          render: "timeline",
        }, () => {
          state.trackHeights ||= {};
          state.trackHeights[grip.dataset.resizeTrack] = 56;
          return true;
        });
        event.preventDefault();
      });
      $("trackLabels").onclick = (event) => {
        const autoButton = event.target.closest("[data-auto-track]");
        if (autoButton) {
          const key = autoButton.dataset.autoTrack;
          runTimelineCommand("切换自动轨道选择", { recompute: false, render: "timeline" }, () => {
            state.trackAutoSelect ||= {};
            state.trackAutoSelect[key] = !isTrackAutoSelected(key);
            return true;
          });
          toast(`${trackInfo(key).label}自动选择已${state.trackAutoSelect[key] ? "开启" : "关闭"}`);
          return;
        }
        const muteButton = event.target.closest("[data-mute-track]");
        if (muteButton) {
          const key = muteButton.dataset.muteTrack;
          runTimelineCommand("切换轨道静音", { recompute: false }, () => {
            state.trackMute ||= {};
            state.trackMute[key] = !state.trackMute[key];
            return true;
          });
          toast(`${trackInfo(key).label}已${state.trackMute[key] ? "静音" : "取消静音"}`);
          return;
        }
        const soloButton = event.target.closest("[data-solo-track]");
        if (soloButton) {
          const key = soloButton.dataset.soloTrack;
          runTimelineCommand("切换轨道独听", { recompute: false }, () => {
            state.trackSolo ||= {};
            state.trackSolo[key] = !state.trackSolo[key];
            return true;
          });
          return;
        }
        const heightButton = event.target.closest("[data-height-track]");
        if (heightButton) {
          const key = heightButton.dataset.heightTrack;
          const delta = Number(heightButton.dataset.heightDelta || 12);
          const current = Number(state.trackHeights?.[key] || 56);
          runTimelineCommand("调整轨道高度", { recompute: false, render: "timeline" }, () => {
            state.trackHeights ||= {};
            state.trackHeights[key] = clamp(current + delta, 40, 220);
            return true;
          });
          return;
        }
        const button = event.target.closest("[data-toggle-track]");
        if (!button) return;
        const key = button.dataset.toggleTrack;
        runTimelineCommand("切换轨道显示", { recompute: false }, () => {
          state.trackVisibility[key] = state.trackVisibility[key] === false;
          return true;
        });
      };
      $("linkAV").onclick = () => {
        const previousAudioClips = mainAudioClips();
        state.avLinked = !state.avLinked;
        if (!state.avLinked) {
          state.mainAudioTimelineOffset = Number(state.mainTimelineOffset || 0);
          state.mainAudioClipOffsets = {
            ...(state.mainVideoClipOffsets || {}),
          };
          prepareIndependentMainAudio();
          adoptMainAudioMaps(previousAudioClips);
        }
        state.audio.offset = 0;
        $("linkAV")?.classList.toggle("active", state.avLinked);
        $("linkAV")?.classList.toggle("primary", state.avLinked);
        $("linkAV").title = state.avLinked
          ? "联动选择：成组音画一起移动和删除"
          : "联动选择已关闭，音画可独立调整";
        toast(state.avLinked ? "联动选择已开启：成组音画一起选、移、剪、删" : "联动选择已关闭：各片段独立调整");
        renderTimeline();
        queueAutosave();
      };
      $("snapToggle").onclick = toggleSnapping;
      if ($("selectionFollowsPlayhead")) {
        $("selectionFollowsPlayhead").onclick = () => {
          state.selectionFollowsPlayhead = !state.selectionFollowsPlayhead;
          $("selectionFollowsPlayhead").classList.toggle("active", state.selectionFollowsPlayhead);
          if (state.selectionFollowsPlayhead) scheduleSelectionFollowsPlayhead();
          queueAutosave();
          toast(`播放头跟随选择已${state.selectionFollowsPlayhead ? "开启" : "关闭"}`);
        };
      }
      if ($("mergeClips")) $("mergeClips").onclick = mergeSelectedClips;
      $("stepBack").onclick = () => seekTimeline(state.currentTime - 1 / 30);
      $("stepForward").onclick = () => seekTimeline(state.currentTime + 1 / 30);
      if ($("jumpPrevCut")) $("jumpPrevCut").onclick = () => jumpToCutPoint("prev");
      if ($("jumpNextCut")) $("jumpNextCut").onclick = () => jumpToCutPoint("next");
      if ($("trimLeft")) $("trimLeft").onclick = () => trimAtPlayhead("left");
      if ($("trimRight")) $("trimRight").onclick = () => trimAtPlayhead("right");
      if ($("freezeFrame")) $("freezeFrame").onclick = createFreezeFrame;
      if ($("zoomOutBtn")) $("zoomOutBtn").onclick = () => setTimelineZoomAroundPlayhead(state.zoom * 0.85);
      if ($("zoomInBtn")) $("zoomInBtn").onclick = () => setTimelineZoomAroundPlayhead(state.zoom * 1.18);
      $("splitClip").onclick = splitSelected;
      if ($("selectAfterPlayhead")) $("selectAfterPlayhead").onclick = selectAfterPlayhead;
      if ($("selectTool"))
        $("selectTool").onclick = () => {
          setEditTool("select");
          toast("选择模式 (A)：修剪当前片段，前后锁定不动");
        };
      if ($("trimTool"))
        $("trimTool").onclick = () => {
          setEditTool(editTool === "trim" ? "select" : "trim");
          toast(editTool === "trim" ? "波纹修剪模式 (T)：拖动边缘全轨推移" : "选择模式 (A)");
        };
      if ($("bladeTool"))
        $("bladeTool").onclick = () => {
          setEditTool(editTool === "blade" ? "select" : "blade");
          toast(editTool === "blade" ? "剃刀模式 (B)：点击片段切割" : "选择模式 (A)");
        };
      $("deleteClip").onclick = () => deleteSelected(true);
      $("rippleDelete").onclick = () => deleteSelected(false);
      $("undo").onclick = restoreSnapshot;
      $("redo").onclick = redoSnapshot;
      $("openProject").onclick = openProject;
      $("resetProject").onclick = () => {
        askConfirm(
          "确定重置整个工程？所有轨道、素材和参数都会清空，原素材会移入工程的重置历史目录。",
          async () => {
            const reset = await nativeCall("resetProject", state.projectId);
            await enterProject(reset);
            toast("工程已恢复到初始状态");
          },
          "重置工程",
        );
      };
      $("clearProjectCache").onclick = () => {
        askConfirm(
          "只清理当前工程生成的缩略图、预览图和旧版复制素材。原始本地文件不会被删除；旧版缓存素材如果没有原文件，需要之后重新导入或关联。",
          async () => {
            const result = await nativeCall("clearProjectCache", state.projectId);
            await enterProject(result.project);
            toast(`当前工程缓存已清理（${result.removed || 0} 项）`);
          },
          "清理当前工程缓存",
        );
      };
      $("exportVideo").onclick = openExportSettings;
      $("sendResolve").onclick = sendCaptionsToResolve;
      $("openResolveLog").onclick = () => nativeCall("revealResolveLog").catch((error) => toast(error.message));
      $("closeSendResolve").onclick = () => $("sendResolveModal").classList.remove("on");
      $("sendResolveModal").onclick = (event) => {
        if (event.target === $("sendResolveModal") && !$("closeSendResolve").disabled)
          $("sendResolveModal").classList.remove("on");
      };
      $("exportResolve").onclick = exportResolveTimeline;
      $("exportSettingsCancel").onclick = () =>
        $("exportSettingsModal").classList.remove("on");
      $("exportSettingsConfirm").onclick = exportVideo;
      for (const id of [
        "exportFormat", "exportResolution", "exportFps", "exportCodec",
        "exportBitrate", "exportQuality", "exportColorSpace",
      ]) $(id).addEventListener("change", updateExportSummary);
      if ($("exportUseGpu"))
        $("exportUseGpu").onchange = () => {
          if ($("exportUseGpu").checked) applyExportDevice("gpu");
          else applyExportDevice("cpu");
          persistExportDevice();
          updateExportSummary();
        };
      if ($("exportUseCpu"))
        $("exportUseCpu").onchange = () => {
          if ($("exportUseCpu").checked) applyExportDevice("cpu");
          else applyExportDevice("gpu");
          persistExportDevice();
          updateExportSummary();
        };
      if ($("refreshExportHardware"))
        $("refreshExportHardware").onclick = async () => {
          const button = $("refreshExportHardware");
          button.disabled = true;
          button.textContent = "检测中…";
          try {
            const hardware = await loadExportHardware(true);
            updateExportSummary();
            toast(hardware.vendor === "software"
              ? "未检测到可实际编码的独显；请确认驱动完整安装"
              : `已识别 ${hardware.label || hardware.vendor}`);
          } catch (error) {
            toast(error.message);
          } finally {
            button.disabled = false;
            button.textContent = "重新检测显卡";
          }
        };
      $("exportColorSpace").onchange = (event) => {
        if (["hlg", "pq"].includes(event.target.value)) {
          $("exportCodec").value = "hevc";
          toast("HDR 色彩空间已自动选用 H.265 / HEVC 10-bit 导出");
        }
        updateExportSummary();
      };
      $("previewDenoise").onclick = previewDenoise;
      $("applyDenoiseTrack").onclick = applyDenoiseToTrack;
      $("analyzeDenoiseNoise").onclick = analyzeDenoiseNoise;
      if ($("revertDenoisedTrack")) $("revertDenoisedTrack").onclick = revertDenoisedTrack;
      $("trimLeft").onclick = () => trimAtPlayhead("left");
      $("trimRight").onclick = () => trimAtPlayhead("right");
      $("freezeFrame").onclick = createFreezeFrame;
      $("resetColor").onclick = () => {
        snapshot();
        Object.keys(state.color).forEach((k) => (state.color[k] = 0));
        state.filterLook = { id: "none", intensity: 1, baseColor: null };
        state.lut = null;
        colorControls();
        applyVideoCss();
        renderFilterPanel();
        queueAutosave();
      };
      const gradePresets = {
        auto: { exposure: 4, contrast: 10, pivot: 3, shadows: 7, highlights: -9, blacks: -3, whites: 4, saturation: 5, vibrance: 8, sharpness: 8 },
        flat: { exposure: 5, contrast: -7, shadows: 12, highlights: -16, blacks: 4, whites: -3, saturation: -4, vibrance: 8, temperature: 3, midtoneDetail: -6, sharpness: 4 },
        cinema: { exposure: -2, contrast: 22, pivot: -4, shadows: -9, highlights: -12, blacks: -10, whites: 7, saturation: -8, vibrance: 12, temperature: 4, midtoneDetail: 9, sharpness: 12, vignette: 14 },
      };
      document.querySelectorAll("[data-grade-preset]").forEach((button) => {
        button.onclick = () => {
          snapshot();
          Object.keys(state.color).forEach((key) => (state.color[key] = 0));
          Object.assign(state.color, gradePresets[button.dataset.gradePreset] || {});
          state.filterLook = { id: "none", intensity: 1, baseColor: null };
          state.lut = null;
          colorControls();
          applyVideoCss();
          renderFilterPanel();
          queueAutosave();
          toast(`已应用${button.textContent.trim()}校色`);
        };
      });
      $("toggleColor").onclick = () => {
        state.colorBypass = !state.colorBypass;
        applyVideoCss();
        $("toggleColor").textContent = state.colorBypass
          ? "显示调色后"
          : "对比原片";
      };
      $("resetBeauty").onclick = () => {
        snapshot();
        Object.keys(state.beauty).forEach((key) => (state.beauty[key] = 0));
        beautyControls();
        applyVideoCss();
        queueAutosave();
      };
      $("toggleBeauty").onclick = () => {
        state.beautyBypass = !state.beautyBypass;
        applyVideoCss();
        $("toggleBeauty").textContent = state.beautyBypass
          ? "显示美颜后"
          : "对比原片";
      };
      document
        .querySelectorAll("[data-ratio]")
        .forEach((b) => (b.onclick = () => setRatio(b.dataset.ratio)));
      if ($("previewFullscreen")) $("previewFullscreen").onclick = togglePreviewFullscreen;
      $("resolution").onchange = (e) => {
        [state.width, state.height] = e.target.value.split("x").map(Number);
        updateFrameSize();
      };
      