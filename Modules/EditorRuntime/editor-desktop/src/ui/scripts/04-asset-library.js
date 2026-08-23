function addLibraryAsset(media, kind) {
        state.hiddenLibraryPaths = (state.hiddenLibraryPaths || []).filter(
          (item) => item !== media?.path,
        );
        const existing = state.libraryAssets.find(
          (item) => item.path === media.path,
        );
        if (existing) {
          Object.assign(existing, media, {
            kind: kind || media.kind || existing.kind,
          });
          return existing;
        }
        const asset = {
          id: uid(),
          kind: kind || media.kind || "file",
          ...media,
        };
        state.libraryAssets.push(asset);
        return asset;
      }
      function removeLibraryAsset(id) {
        snapshot();
        const removed = state.libraryAssets.find((asset) => asset.id === id);
        if (removed?.path && !(state.hiddenLibraryPaths || []).includes(removed.path))
          state.hiddenLibraryPaths.push(removed.path);
        state.libraryAssets = state.libraryAssets.filter((asset) => asset.id !== id);
        libraryMediaRenderKey = "";
        mediaList();
        queueAutosave();
      }
      function replaceAssetReferences(oldPath, replacement) {
        if (!oldPath || !replacement?.path) return;
        const collections = [
          state.libraryAssets,
          state.videoLayers,
          state.audioAssets,
          state.images,
        ];
        const merge = (item) => {
          if (!item || item.path !== oldPath) return;
          const identity = { id: item.id, trackId: item.trackId };
          Object.assign(item, replacement, identity, { missing: false });
        };
        if (state.video?.path === oldPath) merge(state.video);
        for (const collection of collections)
          for (const item of collection || []) merge(item);
        libraryMediaRenderKey = "";
        renderAll();
        queueAutosave();
      }
      async function refreshSourceAvailability() {
        if (!state.editorActive) return;
        const collections = [
          state.video ? [state.video] : [],
          state.libraryAssets,
          state.videoLayers,
          state.audioAssets,
          state.images,
        ];
        const items = collections.flat().filter((item) => item?.path);
        if (!items.length) return;
        const status = await nativeCall(
          "assetAvailability",
          items.map((item) => item.originalPath || item.path),
        );
        const availability = new Map(status.map((item) => [item.path, item.exists]));
        let changed = false;
        for (const item of items) {
          const source = item.originalPath || item.path;
          if (availability.get(source) !== false || item.missing) continue;
          item.missing = true;
          item.url = "";
          item.previewUrl = "";
          item.previewPath = "";
          changed = true;
        }
        if (!changed) return;
        if (state.video?.missing) {
          $("video").removeAttribute("src");
          $("video").load?.();
          $("stage").classList.add("empty");
          state.projectCoverPath = "";
        }
        libraryMediaRenderKey = "";
        renderAll();
        queueAutosave();
        toast("检测到本地素材已移动或删除，可在素材库右键重新关联");
      }
      async function relinkLibraryAsset(asset) {
        const replacement = await nativeCall("relinkAsset", {
          projectId: state.projectId,
          kind: asset.kind,
        });
        if (!replacement) return false;
        replaceAssetReferences(asset.path, replacement);
        watchMediaAnalysis(replacement);
        toast("素材已重新关联");
        return true;
      }
      const mediaAnalysisWatchers = new Set();
      function applyMediaAnalysisResult(filePath, result) {
        if (!filePath || !result) return;
        const collections = [
          state.libraryAssets,
          state.videoLayers,
          state.audioAssets,
        ];
        for (const collection of collections)
          for (const item of collection || [])
            if (item?.path === filePath) {
              const waiting = !!item.analysisPending;
              Object.assign(item, result, { analysisPending: false });
              if (waiting && Number(result.duration || 0) > 0 && "start" in item) {
                item.sourceDuration = Number(result.duration);
                item.end = Number(item.start || 0) +
                  Number(result.duration) / Math.max(0.5, Number(state.audio.speed || 1));
              }
            }
        // A video is placed immediately; when background probing confirms it
        // has audio, create the linked audio layer without making the user wait.
        for (const item of state.videoLayers || []) {
          if (
            item.path !== filePath ||
            !result.audioCodec ||
            item.linkedAudioId ||
            state.audioAssets.some((audio) => audio.linkedVideoId === item.id)
          )
            continue;
          const trackId = createDynamicTrack(
            "audio",
            `${item.name || "视频"} · 音频`,
            "audio",
          );
          const audioItem = {
            id: uid(),
            trackId,
            libraryId: item.libraryId,
            path: item.path,
            url: item.url,
            name: `${item.name || "视频"} · 音频`,
            start: item.start,
            end: item.end,
            sourceStart: item.sourceStart || 0,
            sourceDuration: item.sourceDuration || result.duration,
            volume: 1,
            pan: 0,
            muted: false,
            linkedVideoId: item.id,
            linkGroupId: item.linkGroupId,
            waveform: result.waveform || [],
            previewPath: result.previewPath || "",
            previewUrl: result.previewUrl || "",
          };
          item.linkedAudioId = audioItem.id;
          state.audioAssets.push(audioItem);
        }
        if (state.video?.path === filePath) {
          Object.assign(state.video, result, { analysisPending: false });
          state.waveform = result.waveform || state.waveform || [];
          state.sourceDuration = Number(result.duration || state.sourceDuration || 0);
          recomputeContentDuration();
        }
        if (state.denoisedAudio?.path === filePath)
          Object.assign(state.denoisedAudio, result);
        libraryMediaRenderKey = "";
        mediaList();
        scheduleTimelineRender();
        schedulePreviewRender();
        queueAutosave();
      }
      async function watchMediaAnalysis(asset) {
        const jobId = asset?.analysisJobId;
        if (!jobId || mediaAnalysisWatchers.has(jobId)) return;
        mediaAnalysisWatchers.add(jobId);
        const filePath = asset.path;
        let previewApplied = !!asset.previewUrl;
        try {
          while (true) {
            await new Promise((resolve) => setTimeout(resolve, 520));
            const job = await nativeCall("mediaAnalysisStatus", jobId);
            if (!previewApplied && job.result?.previewUrl) {
              previewApplied = true;
              applyMediaAnalysisResult(filePath, job.result);
            }
            if (job.state === "completed") {
              applyMediaAnalysisResult(filePath, job.result || {});
              break;
            }
            if (job.state === "failed") break;
          }
        } catch (error) {
          console.warn("media analysis", error);
        } finally {
          mediaAnalysisWatchers.delete(jobId);
        }
      }
      function watchProjectMediaAnalysis() {
        const assets = [
          state.video,
          state.denoisedAudio,
          ...(state.videoLayers || []),
          ...(state.audioAssets || []),
        ];
        for (const asset of assets) watchMediaAnalysis(asset);
      }
      function parseSubtitleTime(value) {
        const match = String(value || "")
          .trim()
          .match(/(\d+):([0-5]\d):([0-5]\d)[,.](\d{1,3})/);
        if (!match) return 0;
        return (
          Number(match[1]) * 3600 +
          Number(match[2]) * 60 +
          Number(match[3]) +
          Number(match[4].padEnd(3, "0")) / 1000
        );
      }
      function parseSubtitleContent(content) {
        const normalized = String(content || "")
          .replace(/^WEBVTT[^\n]*\n+/i, "")
          .replace(/\r/g, "");
        const blocks = normalized.split(/\n{2,}/);
        const items = [];
        for (const block of blocks) {
          const lines = block.split("\n").filter(Boolean);
          const timeIndex = lines.findIndex((line) => line.includes("-->"));
          if (timeIndex < 0) continue;
          const [startText, endText] = lines[timeIndex].split("-->");
          const text = lines
            .slice(timeIndex + 1)
            .join(" ")
            .replace(/<[^>]+>/g, "")
            .replace(/\s+/g, " ")
            .trim();
          if (!text) continue;
          const start = parseSubtitleTime(startText),
            end = parseSubtitleTime(endText);
          if (end > start) items.push({ id: uid(), start, end, text });
        }
        return items;
      }
      function resetMainMediaModifiers() {
        state.mainTimelineOffset = 0;
        state.mainAudioTimelineOffset = 0;
        state.mainVideoClipOffsets = {};
        state.mainAudioClipOffsets = {};
        state.mainAudioRemovals = [];
        state.mainAudioManualCuts = [];
        state.audioCuts = [];
        state.projectCoverPath = "";
        state.videoTransform = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, blendMode: "normal" };
        state.mainVideoClipSettings = {};
        state.color = {
          exposure: 0,
          contrast: 0,
          pivot: 0,
          lift: 0,
          gamma: 0,
          gain: 0,
          shadows: 0,
          highlights: 0,
          blacks: 0,
          whites: 0,
          saturation: 0,
          temperature: 0,
          tint: 0,
          vibrance: 0,
          hue: 0,
          midtoneDetail: 0,
          sharpness: 0,
          fade: 0,
          vignette: 0,
        };
        state.beauty = {
          smoothing: 0,
          blemish: 0,
          texture: 0,
          whitening: 0,
          brighten: 0,
          warmth: 0,
          rosy: 0,
        };
        state.denoise = defaultDenoiseSettings();
        state.denoiseEnabled = false;
        state.denoisedAudio = null;
        state.audio = {
          speed: 1,
          volume: 1,
          pan: 0,
          bass: 0,
          treble: 0,
          compressor: 0.35,
          limiter: true,
          offset: 0,
          channelMode: "original",
          presence: 0,
          deesser: 0,
          voiceEnhance: 0,
          normalize: false,
          lowCut: 60,
          highCut: 16500,
        };
        state.mainAudioClipSettings = {};
        state.audioProcessingEnabled = false;
        state.mainVideoTrackMap = {};
        state.mainAudioTrackMap = {};
        state.colorBypass = false;
        state.beautyBypass = false;
      }
      async function importVideo(
        info = null,
        placement = "timeline",
        at = state.currentTime,
        preferredTrackId = "",
      ) {
        try {
          const media =
            info ||
            (await nativeCall("pickVideo", { projectId: state.projectId }));
          if (!media) return;
          const asset = addLibraryAsset(media, "video");
          watchMediaAnalysis(asset);
          if (placement === "media") {
            renderAll();
            toast("视频已加入素材区，可拖到预览窗口或时间线");
            return asset;
          }
          snapshot();
          if (state.video) {
            const canUsePreferred =
              preferredTrackId &&
              trackInfo(preferredTrackId).kind === "video" &&
              preferredTrackId !== "video";
            const trackId = canUsePreferred
              ? preferredTrackId
              : createDynamicTrack("video", "", "video");
            const start = clamp(Number(at) || 0, 0, visibleTimelineDuration());
            const sourceDuration = Math.max(0.04, Number(asset.duration || 3));
            const linkGroupId = uid();
            const item = {
              id: uid(),
              trackId,
              libraryId: asset.id,
              path: asset.path,
              url: asset.url,
              name: asset.name,
              start,
              end: start + sourceDuration / Math.max(0.5, Number(state.audio.speed || 1)),
              sourceStart: 0,
              sourceDuration,
              linkGroupId,
              x: 0,
              y: 0,
              scale: 1,
              opacity: 1,
              rotation: 0,
              blendMode: "normal",
              volume: 1,
              previewPath: asset.previewPath || "",
              previewUrl: asset.previewUrl || "",
              waveform: asset.waveform || [],
              width: Number(asset.width || 0),
              height: Number(asset.height || 0),
              videoCodec: asset.videoCodec || "",
              audioCodec: asset.audioCodec || "",
              analysisPending: !!asset.analysisPending,
            };
            state.videoLayers.push(item);
            if (asset.audioCodec) {
              const audioTrackId = createDynamicTrack(
                "audio",
                `${asset.name || "视频"} · 音频`,
                "audio",
              );
              const audioItem = {
                id: uid(),
                trackId: audioTrackId,
                libraryId: asset.id,
                path: asset.path,
                url: asset.url,
                name: `${asset.name || "视频"} · 音频`,
                start,
                end: item.end,
                sourceStart: 0,
                sourceDuration,
                volume: 1,
                pan: 0,
                fadeIn: 0,
                fadeOut: 0,
                muted: false,
                linkedVideoId: item.id,
                linkGroupId,
                waveform: asset.waveform || [],
                previewPath: asset.previewPath || "",
                previewUrl: asset.previewUrl || "",
              };
              item.linkedAudioId = audioItem.id;
              state.audioAssets.push(audioItem);
            }
            recomputeContentDuration();
            state.selected = { type: "videolayer", id: item.id };
            state.selectedItems = [{ type: "videolayer", id: item.id }];
            seekTimeline(start);
            renderAll();
            toast("已在主视频上方新建视频轨道");
            return asset;
          }
          resetMainMediaModifiers();
          state.video = { ...asset };
          state.sourceDuration = Number(asset.duration || 0);
          state.duration =
            state.sourceDuration /
            Math.max(0.5, Number(state.audio.speed || 1));
          state.timelineDuration = Math.max(60, state.duration + 10);
          state.removals = [];
          state.manualCuts = [];
          state.mainAudioRemovals = [];
          state.mainAudioManualCuts = [];
          state.audioMutes = [];
          state.waveform = asset.waveform || [];
          state.captions = [];
          state.reviewCaptions = [];
          state.issues = [];
          state.currentTime = 0;
          state.selected = { type: "video", id: "main" };
          state.selectedItems = [{ type: "video", id: "main" }];
          $("video").src = asset.url;
          $("stage").classList.remove("empty");
          renderAll();
          toast("视频已加入时间线；需要时点击“自动剪停顿”");
          return asset;
        } catch (e) {
          toast(e.message);
        }
      }
      async function importImage(
        info = null,
        placement = "timeline",
        at = state.currentTime,
        preferredTrackId = "",
      ) {
        try {
          const media =
            info ||
            (await nativeCall("pickImage", { projectId: state.projectId }));
          if (!media) return;
          const asset = addLibraryAsset(media, "image");
          if (placement === "media") {
            renderAll();
            toast("图片已加入素材区，可继续拖到画面或时间线");
            return asset;
          }
          snapshot();
          const trackId =
            preferredTrackId && trackInfo(preferredTrackId).kind === "image"
              ? preferredTrackId
              : createDynamicTrack("image", "", "video");
          const item = {
            id: uid(),
            trackId,
            libraryId: asset.id,
            path: asset.path,
            url: asset.url,
            name: asset.name,
            start: clamp(Number(at) || 0, 0, visibleTimelineDuration()),
            end: clamp(Number(at) || 0, 0, visibleTimelineDuration()) + 3,
            x: 0,
            y: 0,
            scale: 1,
            opacity: 1,
            rotation: 0,
            blendMode: "normal",
            enterAnimation: "",
            exitAnimation: "",
            enterDuration: 0.45,
            exitDuration: 0.45,
          };
          const imgTester = new Image();
          imgTester.src = asset.url;
          imgTester.onload = () => {
            item.sourceWidth = imgTester.naturalWidth;
            item.sourceHeight = imgTester.naturalHeight;
            renderPreviewObjects();
          };
          state.images.push(item);
          recomputeContentDuration();
          state.selected = { type: "image", id: item.id };
          state.selectedItems = [{ type: "image", id: item.id }];
          seekTimeline(item.start);
          renderAll();
          return asset;
        } catch (e) {
          toast(e.message);
        }
      }
      async function importAudio(
        info = null,
        placement = "timeline",
        at = state.currentTime,
        preferredTrackId = "",
      ) {
        try {
          const media =
            info ||
            (await nativeCall("pickAudio", { projectId: state.projectId }));
          if (!media) return;
          const asset = addLibraryAsset(media, "audio");
          watchMediaAnalysis(asset);
          if (placement === "media") {
            renderAll();
            toast("音频已加入素材区，可继续拖到时间线");
            return asset;
          }
          snapshot();
          const start = clamp(Number(at) || 0, 0, visibleTimelineDuration()),
            trackId =
              preferredTrackId &&
              trackInfo(preferredTrackId).kind === "audio" &&
              preferredTrackId !== "audio"
                ? preferredTrackId
                : createDynamicTrack("audio", "", "audio"),
            item = {
              id: uid(),
              trackId,
              libraryId: asset.id,
              path: asset.path,
              url: asset.url,
              name: asset.name,
              start,
              end: start + Number(asset.duration || 3) /
                Math.max(0.5, Number(state.audio.speed || 1)),
              sourceStart: 0,
              sourceDuration: Number(asset.duration || 3),
              volume: 1,
              pan: 0,
              fadeIn: 0,
              fadeOut: 0,
              muted: false,
              waveform: asset.waveform || [],
              previewPath: asset.previewPath || "",
              previewUrl: asset.previewUrl || "",
              analysisPending: !!asset.analysisJobId || !!asset.analysisPending,
            };
          state.audioAssets.push(item);
          recomputeContentDuration();
          state.selected = { type: "audioasset", id: item.id };
          state.selectedItems = [{ type: "audioasset", id: item.id }];
          seekTimeline(start);
          renderAll();
          return asset;
        } catch (e) {
          toast(e.message);
        }
      }
      async function importSubtitle(
        info = null,
        placement = "timeline",
        at = state.currentTime,
        preferredTrackId = "",
      ) {
        try {
          const media =
            info ||
            (await nativeCall("pickSubtitle", { projectId: state.projectId }));
          if (!media) return;
          const asset = addLibraryAsset(media, "subtitle");
          if (placement === "media") {
            renderAll();
            toast("字幕文件已加入素材区，可继续拖到时间线");
            return asset;
          }
          const parsed = parseSubtitleContent(asset.content);
          if (!parsed.length) {
            toast("没有识别到有效的 SRT 或 VTT 字幕");
            return asset;
          }
          snapshot();
          const trackId =
            preferredTrackId &&
            trackInfo(preferredTrackId).kind === "caption" &&
            preferredTrackId !== "caption"
              ? preferredTrackId
              : createDynamicTrack("caption", "", "caption");
          const offset = (Number(at) || 0) - parsed[0].start;
          for (const caption of parsed) {
            const start = Math.max(0, caption.start + offset),
              end = caption.end + offset;
            if (end > start)
              state.captions.push({
                ...caption,
                id: uid(),
                trackId,
                start,
                end,
                text: caption.text.replace(/\s+/g, " "),
              });
          }
          state.captions.sort((a, b) => a.start - b.start);
          recomputeContentDuration();
          const first = state.captions.find((item) => item.trackId === trackId);
          state.selected = { type: "caption", id: first?.id || "" };
          state.selectedItems = first ? [{ type: "caption", id: first.id }] : [];
          renderAll();
          toast(`已加入 ${parsed.length} 条字幕`);
          return asset;
        } catch (e) {
          toast(e.message);
        }
      }
      async 