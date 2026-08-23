function currentPauseCutOptions() {
        const fps = Math.max(1, Number(state.fps || state.video?.fps || 25));
        const minPause = Number($("pauseMinDuration")?.value || 80) / 100;
        const buffer = Number($("pauseBuffer")?.value || 15) / 100;
        const sensitivity = Number($("pauseSensitivity")?.value || 65) / 100;
        const thresholdDb = Number($("pauseThresholdDb")?.value || -25.0);
        const headFrames = Math.max(0, Number($("pauseHeadFrames")?.value || 0));
        const tailFrames = Math.max(0, Number($("pauseTailFrames")?.value || 0));
        const minFrames = Math.max(1, Number($("pauseMinFrames")?.value || 2));
        return {
          keepSeconds: Math.max(0.1, buffer * 2),
          minPauseSeconds: Math.max(0.2, minPause),
          edgeKeepSeconds: Math.max(0.05, buffer),
          sensitivity,
          trimCaptionGaps: $("pauseTrimCaptionGaps")?.checked !== false,
          thresholdDb,
          preRollSeconds: headFrames > 0 ? headFrames / fps : undefined,
          postRollSeconds: tailFrames > 0 ? tailFrames / fps : undefined,
          minDurationSeconds: minFrames / fps,
          headFrames,
          tailFrames,
          minFrames,
          crossfade: $("pauseCrossfade")?.checked !== false,
        };
      }
      function syncPauseCutSettingsUI(source = "range") {
        if ($("pauseMinDurationOut"))
          $("pauseMinDurationOut").textContent = `${(Number($("pauseMinDuration").value) / 100).toFixed(2)} 秒`;
        if ($("pauseBufferOut"))
          $("pauseBufferOut").textContent = `${(Number($("pauseBuffer").value) / 100).toFixed(2)} 秒`;
        if ($("pauseSensitivityOut"))
          $("pauseSensitivityOut").textContent = `${$("pauseSensitivity").value}%`;
        if (source === "range") {
          if ($("pauseThresholdDbInput")) $("pauseThresholdDbInput").value = Number($("pauseThresholdDb").value).toFixed(1);
          if ($("pauseHeadFramesInput")) $("pauseHeadFramesInput").value = $("pauseHeadFrames").value;
          if ($("pauseTailFramesInput")) $("pauseTailFramesInput").value = $("pauseTailFrames").value;
          if ($("pauseMinFramesInput")) $("pauseMinFramesInput").value = $("pauseMinFrames").value;
        } else if (source === "input") {
          if ($("pauseThresholdDb")) $("pauseThresholdDb").value = $("pauseThresholdDbInput").value;
          if ($("pauseHeadFrames")) $("pauseHeadFrames").value = $("pauseHeadFramesInput").value;
          if ($("pauseTailFrames")) $("pauseTailFrames").value = $("pauseTailFramesInput").value;
          if ($("pauseMinFrames")) $("pauseMinFrames").value = $("pauseMinFramesInput").value;
        }
      }
      for (const id of ["pauseMinDuration", "pauseBuffer", "pauseSensitivity"]) {
        const el = $(id);
        if (el) el.oninput = () => syncPauseCutSettingsUI("range");
      }
      for (const id of ["pauseThresholdDb", "pauseHeadFrames", "pauseTailFrames", "pauseMinFrames"]) {
        const rangeEl = $(id);
        if (rangeEl) rangeEl.oninput = () => syncPauseCutSettingsUI("range");
        const inputEl = $(`${id}Input`);
        if (inputEl) {
          inputEl.oninput = () => syncPauseCutSettingsUI("input");
          inputEl.onchange = () => syncPauseCutSettingsUI("input");
        }
      }
      function openPauseCutSettingsModal() {
        syncPauseCutSettingsUI("range");
        if ($("pauseAnalysisSummary")) $("pauseAnalysisSummary").style.display = "none";
        $("pauseCutModal").classList.add("on");
      }
      function closePauseCutSettingsModal() {
        $("pauseCutModal").classList.remove("on");
      }
      if ($("openPauseCutSettings")) $("openPauseCutSettings").onclick = openPauseCutSettingsModal;
      if ($("pauseCutCancel")) $("pauseCutCancel").onclick = closePauseCutSettingsModal;
      if ($("pauseCutModal")) {
        $("pauseCutModal").onclick = (e) => {
          if (e.target === $("pauseCutModal")) closePauseCutSettingsModal();
        };
      }
      if ($("analyzePauseBtn"))
        $("analyzePauseBtn").onclick = async () => {
          if (!state.video) {
            toast("请先导入视频");
            return;
          }
          const btn = $("analyzePauseBtn");
          btn.disabled = true;
          btn.textContent = "分析中…";
          try {
            const opts = currentPauseCutOptions();
            const result = unwrap(
              await window.native.analyzePauses({
                path: state.video.path,
                options: opts,
              }),
            );
            const summaryEl = $("pauseAnalysisSummary");
            if (summaryEl) {
              summaryEl.style.display = "block";
              summaryEl.textContent = `分析结果：找到 ${result.pauses.length} 处停顿气口，剪除后预计缩短 ${formatTime((result.removals || []).reduce((acc, r) => acc + (r.duration || 0), 0))}`;
            }
          } catch (e) {
            toast(e.message);
          } finally {
            btn.disabled = false;
            btn.textContent = "重新分析";
          }
        };
      if ($("applyPauseCutBtn"))
        $("applyPauseCutBtn").onclick = async () => {
          closePauseCutSettingsModal();
          await runPauseCut(currentPauseCutOptions());
        };

      async function runPauseCut(customOptions = null) {
        if (!state.video) {
          toast("请先导入视频");
          return;
        }
        const btn = $("pauseCut");
        btn.disabled = true;
        btn.textContent = "剪停顿中…";
        try {
          snapshot();
          const opts = customOptions || currentPauseCutOptions();
          const result = unwrap(
            await window.native.analyzePauses({
              path: state.video.path,
              options: opts,
            }),
          );
          let allRemovals = [...(result.removals || [])];
          // If trimCaptionGaps is enabled and we have captions, check for long gaps between adjacent captions
          if (opts.trimCaptionGaps && Array.isArray(state.captions) && state.captions.length > 1) {
            const sortedCaptions = [...state.captions].sort((a, b) => Number(a.start || 0) - Number(b.start || 0));
            const minGap = Math.max(1.0, opts.minPauseSeconds || 0.8);
            for (let i = 0; i < sortedCaptions.length - 1; i++) {
              const capEnd = Number(sortedCaptions[i].end || 0);
              const nextStart = Number(sortedCaptions[i + 1].start || 0);
              const gapDuration = nextStart - capEnd;
              if (gapDuration > minGap + 0.3) {
                const gapStart = capEnd + (opts.edgeKeepSeconds || 0.15);
                const gapCutEnd = nextStart - (opts.edgeKeepSeconds || 0.15);
                if (gapCutEnd > gapStart + 0.1) {
                  const sourceStart = timelineToSource(gapStart);
                  const sourceEnd = timelineToSource(gapCutEnd);
                  if (sourceEnd > sourceStart + 0.1) {
                    allRemovals.push({
                      start: sourceStart,
                      end: sourceEnd,
                      duration: sourceEnd - sourceStart,
                      source: "caption-gap",
                    });
                  }
                }
              }
            }
          }
          state.removals = allRemovals;
          state.waveform = result.waveform;
          normalizeRemovals();
          seekTimeline(0);
          renderAll();
          toast(
            `已剪除 ${result.pauses.length} 处气口，共缩短 ${formatTime(removedDuration())}`,
          );
        } catch (e) {
          toast(e.message);
        } finally {
          btn.disabled = false;
          btn.textContent = "自动剪停顿";
        }
      }
      function splitMainClipAt(clip, time, audioOnly = false) {
        if (!clip || !playheadInside(clip, time)) return false;
        if (audioOnly && !state.avLinked) {
          const trackId = state.mainAudioTrackMap?.[clip.id];
          const sourceCut = Number(clip.sourceStart || 0) +
            (Number(time) - Number(clip.start || 0)) *
              Math.max(0.05, Number(state.audio.speed || 1));
          state.mainAudioManualCuts ||= [...(state.manualCuts || [])];
          state.mainAudioManualCuts.push(sourceCut);
          state.mainAudioManualCuts.sort((left, right) => left - right);
          if (trackId) {
            delete state.mainAudioTrackMap[clip.id];
            for (const next of mainAudioClips().filter(
              (item) => item.start >= clip.start - 0.01 && item.end <= clip.end + 0.01,
            ))
              state.mainAudioTrackMap[next.id] = trackId;
          }
          return true;
        }
        const videoTrack = state.mainVideoTrackMap?.[clip.id];
        const audioTrack = state.mainAudioTrackMap?.[clip.id];
        const videoOffset = Number(state.mainVideoClipOffsets?.[clip.id] || 0);
        const audioOffset = Number(state.mainAudioClipOffsets?.[clip.id] || 0);
        state.manualCuts.push(timelineToSource(time));
        delete state.mainVideoTrackMap[clip.id];
        delete state.mainAudioTrackMap[clip.id];
        delete state.mainVideoClipOffsets[clip.id];
        delete state.mainAudioClipOffsets[clip.id];
        for (const next of mainClips().filter(
          (item) =>
            item.sourceStart >= clip.sourceStart - 0.01 &&
            item.sourceEnd <= clip.sourceEnd + 0.01,
        )) {
          state.mainVideoClipOffsets[next.id] = videoOffset;
          state.mainAudioClipOffsets[next.id] = audioOffset;
          if (videoTrack) state.mainVideoTrackMap[next.id] = videoTrack;
          if (audioTrack) state.mainAudioTrackMap[next.id] = audioTrack;
        }
        return true;
      }
      function splitOverlayObject(type, id, time) {
        const obj = timelineObjectFor(type, id);
        if (!obj || selectionIsLocked(type, id) || !playheadInside(obj, time))
          return false;
        const originalStart = Number(obj.start || 0);
        const originalSourceStart = Number(obj.sourceStart || 0);
        const split = splitTimedItem(obj, time, uid());
        if (!split) return false;
        const clone = split.right;
        if (["videolayer", "audioasset"].includes(type)) {
          clone.sourceStart =
            originalSourceStart +
            (time - originalStart) * Math.max(0.5, Number(state.audio.speed || 1));
          if (obj.linkGroupId && state.avLinked) {
            const linked = [...state.videoLayers, ...state.audioAssets].find(
              (item) => item !== obj && item.linkGroupId === obj.linkGroupId,
            );
            if (linked && playheadInside(linked, time)) {
              const secondGroup = uid();
              const linkedStart = Number(linked.start || 0);
              const linkedSource = Number(linked.sourceStart || 0);
              const linkedSplit = splitTimedItem(linked, time, uid());
              if (linkedSplit) {
                const linkedClone = linkedSplit.right;
                linkedClone.sourceStart =
                  linkedSource +
                  (time - linkedStart) * Math.max(0.5, Number(state.audio.speed || 1));
                linkedClone.linkGroupId = secondGroup;
                clone.linkGroupId = secondGroup;
                if (type === "videolayer") {
                  clone.linkedAudioId = linkedClone.id;
                  linkedClone.linkedVideoId = clone.id;
                  state.audioAssets.push(linkedClone);
                } else {
                  clone.linkedVideoId = linkedClone.id;
                  linkedClone.linkedAudioId = clone.id;
                  state.videoLayers.push(linkedClone);
                }
              }
            }
          }
        }
        if (type === "videolayer") state.videoLayers.push(clone);
        if (type === "audioasset") state.audioAssets.push(clone);
        if (type === "image") state.images.push(clone);
        if (type === "text") state.titles.push(clone);
        if (type === "caption") state.captions.push(clone);
        if (type === "review") state.reviewCaptions.push(clone);
        return true;
      }
      function splitClipsAt(time, targets, { record = true, quiet = false } = {}) {
        const hits = (targets || []).filter(
          (item) => item?.id && item.id !== "main" && !selectionIsLocked(item.type, item.id),
        );
        if (!hits.length) return false;
        if (record) snapshot();
        let cut = 0;
        const seen = new Set();
        const mark = (type, id) => {
          const key = `${type}:${id}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        };
        for (const hit of hits) {
          if (hit.type === "video") {
            const clip = mainClips().find((item) => item.id === hit.id);
            if (mark("video", hit.id) && splitMainClipAt(clip, time, false)) cut += 1;
            continue;
          }
          if (hit.type === "audio") {
            const clip = mainAudioClips().find((item) => item.id === hit.id);
            if (mark("audio", hit.id) && splitMainClipAt(clip, time, true)) cut += 1;
            continue;
          }
          if (!mark(hit.type, hit.id)) continue;
          if (splitOverlayObject(hit.type, hit.id, time)) {
            cut += 1;
            if (state.avLinked) {
              for (const partner of linkedTimelineObjects(hit.type, hit.id))
                seen.add(`${partner.type}:${partner.id}`);
            }
          }
        }
        if (!cut) {
          if (record) state.undo.pop();
          return false;
        }
        if (!quiet) {
          renderAll();
          toast(`已在 ${formatTime(time)} 切割 ${cut} 个片段`);
        }
        return true;
      }
      function splitSelected() {
        const time = state.currentTime;
        const under = clipsUnderPlayhead(time);
        if (!under.length) {
          toast("把播放头放到要切的片段上，再按切割");
          return;
        }
        splitClipsAt(time, under);
      }
      function trimAtPlayhead(side) {
        const time = state.currentTime;
        const working = resolveWorkingSelection(
          (state.selectedItems || []).length
            ? state.selectedItems
            : state.selected?.id
              ? [state.selected]
              : [],
        );
        const selectedOverlay = working
          .map((item) => ({ ...item, obj: timelineObjectFor(item.type, item.id) }))
          .find((item) => item.obj && playheadInside(item.obj, time, 0.02));
        if (state.selected.type === "audio" && !state.avLinked) {
          const clip =
            mainAudioClips().find((item) => item.id === state.selected.id) ||
            clipUnderPlayhead("audio", time);
          if (!clip || !playheadInside(clip, time, 0.02)) {
            toast("把播放头放到要剪的音频片段上");
            return;
          }
          snapshot();
          state.audioMutes.push(
            side === "left"
              ? { start: clip.start, end: time }
              : { start: time, end: clip.end },
          );
          renderAll();
          return;
        }
        const mainClip =
          (["video", "audio"].includes(state.selected.type) &&
            mainClips().find((item) => item.id === state.selected.id)) ||
          clipUnderPlayhead("video", time);
        if (mainClip && playheadInside(mainClip, time, 0.02) && !selectedOverlay) {
          if (isTrackLocked(selectionTrackId("video", mainClip.id))) {
            toast("这个轨道已锁定，请先点击轨道前方的锁");
            return;
          }
          snapshot();
          const sourceAt = timelineToSource(time);
          const snapshotClips = mainClips();
          const committed = commitMainEdgeTrim({
            clip: mainClip,
            edge: side === "left" ? "start" : "end",
            targetSource: sourceAt,
            mode: "ripple",
            snapshot: snapshotClips,
          });
          state.removals = committed.removals;
          state.manualCuts = committed.manualCuts;
          normalizeRemovals();
          state.mainVideoClipOffsets = committed.videoOffsets;
          state.mainAudioClipOffsets = committed.audioOffsets;
          adoptClipMaps(snapshotClips, committed.packed);
          applyOverlayRipple(committed.overlayFrom, committed.overlayDelta);
          recomputeContentDuration();
          seekTimeline(Math.min(side === "left" ? mainClip.start : time, state.duration));
          renderAll();
          return;
        }
        const object = selectedOverlay?.obj || currentTimelineObject();
        if (!object || !playheadInside(object, time, 0.02)) {
          toast("把播放头放到要剪的片段上");
          return;
        }
        if (!guardUnlocked(selectedOverlay?.type || state.selected.type, object.id))
          return;
        snapshot();
        const originStart = Number(object.start || 0);
        const originEnd = Number(object.end || originStart);
        if (side === "left")
          object.start = clamp(time, object.start, object.end - 0.04);
        else object.end = clamp(time, object.start + 0.04, object.end);
        if (editTool === "trim") {
          const delta = (Number(object.end) - Number(object.start)) - (originEnd - originStart);
          const type = selectedOverlay?.type || state.selected.type;
          const list =
            type === "videolayer"
              ? state.videoLayers
              : type === "audioasset"
                ? state.audioAssets
                : type === "image"
                  ? state.images
                  : type === "text"
                    ? state.titles
                    : type === "caption"
                      ? state.captions
                      : type === "review"
                        ? state.reviewCaptions
                        : null;
          const from = side === "left" ? originStart : Math.min(originEnd, Number(object.end));
          if (delta < -0.001 && list)
            rippleOverlayTrack(list, overlayTrackId(type, object), type, from, from - delta);
          else if (delta > 0.001 && list) {
            for (const item of list) {
              if (item === object || overlayTrackId(type, item) !== overlayTrackId(type, object)) continue;
              if (Number(item.start || 0) < from - 0.002) continue;
              item.start = Number(item.start || 0) + delta;
              item.end = Number(item.end || 0) + delta;
            }
          }
        }
        if (state.avLinked && object.linkGroupId) {
          const linked = [...state.videoLayers, ...state.audioAssets].find(
            (item) => item !== object && item.linkGroupId === object.linkGroupId,
          );
          if (linked) {
            linked.start = object.start;
            linked.end = object.end;
          }
        }
        renderAll();
      }
      async function createFreezeFrame() {
        if (!state.video) {
          toast("请先导入视频");
          return;
        }
        try {
          const still = await nativeCall("extractStill", {
            projectId: state.projectId,
            path: state.video.path,
            time: timelineToSource(state.currentTime),
          });
          if (!still) return;
          await importImage(still, "timeline", state.currentTime);
          toast("静帧已保存，并加入图片轨道");
        } catch (error) {
          toast(error.message);
        }
      }
      function cleanupEmptyDynamicTracks() {
        for (const trackId of [...state.trackOrder]) {
          const info = trackInfo(trackId);
          if (info.deletable && !trackItems(trackId).length) {
            state.trackOrder = state.trackOrder.filter((id) => id !== trackId);
            delete state.trackDefinitions[trackId];
            delete state.trackVisibility[trackId];
          }
        }
      }
      function clearOrPromoteMainVideo() {
        const candidate = [...state.videoLayers].sort((a, b) => a.start - b.start)[0];
        $("video").pause();
        if (candidate) {
          const inheritedSpeed = Math.max(
            0.5,
            Number(state.audio.speed || 1),
          );
          const duration = Math.max(
            0.04,
            Number(candidate.sourceDuration || candidate.end - candidate.start),
          );
          resetMainMediaModifiers();
          state.video = {
            id: candidate.libraryId || candidate.id,
            kind: "video",
            path: candidate.path,
            url: candidate.url,
            name: candidate.name,
            duration,
            width: candidate.width,
            height: candidate.height,
            videoCodec: candidate.videoCodec,
            audioCodec:
              candidate.audioCodec ||
              (candidate.linkedAudioId ? "linked" : undefined),
            previewPath: candidate.previewPath || "",
            previewUrl: candidate.previewUrl || "",
            waveform: candidate.waveform || [],
          };
          state.sourceDuration = duration;
          state.waveform = candidate.waveform || [];
          state.denoisedAudio = null;
          state.videoTransform = {
            x: Number(candidate.x || 0),
            y: Number(candidate.y || 0),
            scale: Number(candidate.scale || 1),
          };
          const sourceStart = Math.max(0, Number(candidate.sourceStart || 0));
          const sourceEnd = Math.min(
            duration,
            sourceStart + (candidate.end - candidate.start) *
              inheritedSpeed,
          );
          state.removals = [];
          if (sourceStart > 0.002)
            state.removals.push({ start: 0, end: sourceStart, source: "promote-trim" });
          if (sourceEnd < duration - 0.002)
            state.removals.push({ start: sourceEnd, end: duration, source: "promote-trim" });
          state.manualCuts = [];
          state.mainAudioRemovals = state.removals.map((item) => ({ ...item }));
          state.mainAudioManualCuts = [];
          state.audioMutes = [];
          state.videoLayers = state.videoLayers.filter((item) => item.id !== candidate.id);
          if (candidate.linkedAudioId)
            state.audioAssets = state.audioAssets.filter(
              (item) => item.id !== candidate.linkedAudioId,
            );
          $("video").src = candidate.url;
          $("stage").classList.remove("empty");
          normalizeRemovals();
          toast("已把下一条视频设为当前主视频");
        } else {
          state.video = null;
          resetMainMediaModifiers();
          state.sourceDuration = 0;
          state.removals = [];
          state.manualCuts = [];
          state.mainAudioRemovals = [];
          state.mainAudioManualCuts = [];
          state.audioMutes = [];
          state.audioCuts = [];
          state.waveform = [];
          state.captions = [];
          state.reviewCaptions = [];
          state.issues = [];
          $("video").removeAttribute("src");
          $("video").load?.();
          $("stage").classList.toggle(
            "empty",
            !state.videoLayers.length && !state.images.length && !state.titles.length,
          );
          recomputeContentDuration();
        }
        cleanupEmptyDynamicTracks();
      }
      function deleteSelected(ripple = false) {
        console.log("[deleteSelected] ripple=", ripple, "selected=", state.selected, "selectedItems=", JSON.stringify(state.selectedItems));
        if (ripple && timelineGapSelection) {
          const selectedGap = selectedTimelineGapAt(
            timelineGapSelection.trackId,
            (timelineGapSelection.start + timelineGapSelection.end) / 2,
          );
          if (selectedGap)
            return rippleDeleteTimelineGap(timelineGapSelection.trackId, selectedGap);
          timelineGapSelection = null;
        }
        if (state.timelineRange) materializeTimelineRangeSelection();
        const requested = resolveWorkingSelection(
          (state.selectedItems || []).length
            ? [...state.selectedItems]
            : state.selected?.id
              ? [{ ...state.selected }]
              : [],
        );
        const selected = expandLinkedSelection(
          requested.filter((item) => !selectionIsLocked(item.type, item.id)),
        );
        if (!selected.length) {
          const gap = findTimelineGap(timelineGapItems("video"), state.currentTime);
          if (ripple && gap) return rippleDeleteTimelineGap("video", gap);
          toast(requested.length ? "所选轨道已锁定" : "请先选择一个或多个片段");
          return;
        }
        snapshot();
        const ids = (type) =>
          new Set(selected.filter((item) => item.type === type).map((item) => item.id));
        const videoIds = ids("video");
        videoIds.delete("main");
        const audioIds = ids("audio");
        audioIds.delete("main");
        const removeWholeMain = false;
        const shouldRippleAudio = state.avLinked;
        const sourceClips = mainClips();
        const selectedMainClips = sourceClips
          .filter(
            (clip) => videoIds.has(clip.id) || (shouldRippleAudio && audioIds.has(clip.id)),
          )
          .sort((a, b) => b.start - a.start);
        console.log("[deleteSelected] selectedMainClips=", selectedMainClips.length, selectedMainClips.map(c => `${c.id}[${c.sourceStart?.toFixed(2)}-${c.sourceEnd?.toFixed(2)}]`));
        console.log("[deleteSelected] videoIds=", [...videoIds], "audioIds=", [...audioIds], "avLinked=", state.avLinked);
        const rippleClips = selectedMainClips;
        const overlayHoles = selected
          .filter((item) => !["video", "audio"].includes(item.type))
          .map((item) => {
            const obj = timelineObjectFor(item.type, item.id);
            if (!obj) return null;
            return {
              type: item.type,
              trackId: overlayTrackId(item.type, obj),
              start: Number(obj.start || 0),
              end: Number(obj.end || obj.start || 0),
            };
          })
          .filter((hole) => hole && hole.end > hole.start + 0.001)
          .sort((a, b) => b.start - a.start);
        for (const clip of selectedMainClips) {
          state.removals.push({
            start: clip.sourceStart,
            end: clip.sourceEnd,
            source: "manual",
          });
          if (ripple) shiftTracks(clip.start, clip.end - clip.start);
        }
        const audioOnly = mainAudioClips().filter(
          (clip) => audioIds.has(clip.id) && !shouldRippleAudio,
        );
        for (const clip of audioOnly)
          state.audioMutes.push({ start: clip.start, end: clip.end });
        const layerIds = ids("videolayer");
        const audioAssetIds = ids("audioasset");
        if (state.avLinked) {
          for (const layer of state.videoLayers)
            if (layerIds.has(layer.id) && layer.linkedAudioId)
              audioAssetIds.add(layer.linkedAudioId);
          for (const audio of state.audioAssets)
            if (audioAssetIds.has(audio.id) && audio.linkedVideoId)
              layerIds.add(audio.linkedVideoId);
        }
        const keep = (type) => (item) => !ids(type).has(item.id);
        state.videoLayers = state.videoLayers.filter((item) => !layerIds.has(item.id));
        state.audioAssets = state.audioAssets.filter((item) => !audioAssetIds.has(item.id));
        state.images = state.images.filter(keep("image"));
        state.titles = state.titles.filter(keep("text"));
        state.captions = state.captions.filter(keep("caption"));
        state.reviewCaptions = state.reviewCaptions.filter(keep("review"));
        state.issues = state.issues.filter(keep("review"));
        if (ripple && !rippleClips.length) {
          for (const hole of overlayHoles) {
            const list =
              hole.type === "videolayer"
                ? state.videoLayers
                : hole.type === "audioasset"
                  ? state.audioAssets
                  : hole.type === "image"
                    ? state.images
                    : hole.type === "text"
                      ? state.titles
                      : hole.type === "caption"
                        ? state.captions
                        : hole.type === "review"
                          ? state.reviewCaptions
                          : null;
            if (list)
              rippleOverlayTrack(list, hole.trackId, hole.type, hole.start, hole.end);
            if (hole.type === "review")
              rippleOverlayTrack(state.issues, hole.trackId, "review", hole.start, hole.end);
          }
        }
        if (removeWholeMain) clearOrPromoteMainVideo();
        if (selectedMainClips.length) {
          normalizeRemovals();
          const packed = baseMainClips();
          const rippleFrom = selectedMainClips.reduce(
            (min, clip) => Math.min(min, Number(clip.start || 0)),
            Infinity,
          );
          const rippleDelta = ripple ? selectedMainClips.reduce(
            (sum, clip) => sum + (Number(clip.end) - Number(clip.start)),
            0,
          ) : 0;
          const offsets = rebuildClipOffsets({
            snapshot: sourceClips,
            packed,
            globalOffset: Math.max(0, Number(state.mainTimelineOffset || 0)),
            mode: ripple ? "ripple" : "trim",
            rippleFrom,
            rippleDelta,
          });
          state.mainVideoClipOffsets = offsets;
          state.mainAudioClipOffsets = { ...offsets };
          adoptClipMaps(sourceClips, packed);
          console.log("[deleteSelected] after rebuild: packed=", packed.length, "mainClips=", mainClips().length, "offsets=", JSON.stringify(offsets));
          if (!mainClips().length) {
            console.warn("[deleteSelected] ⚠️ mainClips().length === 0 → clearOrPromoteMainVideo triggered! removals=", JSON.stringify(state.removals), "sourceDuration=", state.sourceDuration);
            clearOrPromoteMainVideo();
          }
        }
        cleanupEmptyDynamicTracks();
        recomputeContentDuration();
        state.timelineRange = null;
        state.selectedItems = [];
        state.selected = state.video
          ? { type: "video", id: "main" }
          : { type: "", id: "" };
        seekTimeline(Math.min(state.currentTime, state.duration));
        renderAll();
        toast(`已删除 ${selected.length} 个所选片段${selected.length < requested.length ? "；锁定轨道已跳过" : ""}${ripple ? "，并前移同轨" : ""}`);
      }
      function shiftTracks(at, len) {
        for (const list of [
          state.videoLayers,
          state.audioAssets,
          state.images,
          state.titles,
          state.audioMutes,
        ])
          for (const item of list) {
            if (item.start >= at) {
              item.start = Math.max(at, item.start - len);
              item.end = Math.max(item.start + 0.04, item.end - len);
            } else if (item.end > at)
              item.end = Math.max(item.start + 0.04, item.end - len);
          }
        rippleSubtitleTimeline(at, at + len);
      }
      let speechLanguageCatalog = [];
      