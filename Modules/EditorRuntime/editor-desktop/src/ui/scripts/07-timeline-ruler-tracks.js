function rulerTickPlan(zoom) {
        const z = Number(zoom) || 60;
        if (z < 2) return { major: 300, minor: 60, micro: 12 };
        if (z < 4) return { major: 120, minor: 30, micro: 6 };
        if (z < 8) return { major: 60, minor: 10, micro: 2 };
        if (z < 16) return { major: 30, minor: 5, micro: 1 };
        if (z < 28) return { major: 10, minor: 2, micro: 0.5 };
        if (z < 48) return { major: 5, minor: 1, micro: 0.2 };
        if (z < 80) return { major: 2, minor: 0.5, micro: 0.1 };
        if (z < 130) return { major: 1, minor: 0.2, micro: 1 / 30 };
        if (z < 200) return { major: 0.5, minor: 0.1, micro: 1 / 30 };
        return { major: 0.5, minor: 1 / 30, micro: 1 / 30 };
      }
      function findTimelineGap(items = [], time = 0, minimum = 0.04) {
        const point = Math.max(0, Number(time) || 0);
        const clips = (items || [])
          .map((item) => ({
            ...item,
            start: Math.max(0, Number(item?.start) || 0),
            end: Math.max(0, Number(item?.end) || 0),
          }))
          .filter((item) => item.end > item.start + 0.001)
          .sort((left, right) => left.start - right.start || left.end - right.end);
        if (!clips.length) return null;
        if (clips.some((item) => point >= item.start - 0.002 && point <= item.end + 0.002))
          return null;
        let start = 0,
          end = Infinity;
        for (const item of clips) {
          if (item.end <= point + 0.002) start = Math.max(start, item.end);
          if (item.start >= point - 0.002) end = Math.min(end, item.start);
        }
        if (!Number.isFinite(end) || end - start < Math.max(0.002, Number(minimum) || 0.04))
          return null;
        return { start, end, duration: end - start };
      }
      function timelineGapItems(trackId) {
        if (trackId === "video")
          return mainClips().filter((clip) => !state.mainVideoTrackMap?.[clip.id]);
        if (trackId === "audio")
          return mainAudioClips().filter((clip) => !state.mainAudioTrackMap?.[clip.id]);
        return trackItems(trackId);
      }
      let timelineGapSelection = null;
      function selectedTimelineGapAt(trackId, time) {
        const selected = timelineGapSelection;
        if (!selected || selected.trackId !== trackId) return null;
        if (Number(time) < selected.start - 0.002 || Number(time) > selected.end + 0.002)
          return null;
        const current = findTimelineGap(
          timelineGapItems(trackId),
          (Number(selected.start) + Number(selected.end)) / 2,
        );
        if (!current) return null;
        if (Math.abs(current.start - selected.start) > 0.01 || Math.abs(current.end - selected.end) > 0.01)
          return null;
        return current;
      }
      function rippleDeleteTimelineGap(trackId, gap) {
        console.log("[rippleDeleteGap] trackId=", trackId, "gap=", gap ? `${gap.start.toFixed(3)}-${gap.end.toFixed(3)} dur=${gap.duration.toFixed(3)}` : "null", "locked=", isTrackLocked(trackId));
        if (!gap || gap.duration <= 0.002) return;
        if (isTrackLocked(trackId)) {
          toast("这个轨道已锁定，请先点击轨道前方的锁");
          return;
        }
        const length = Number(gap.duration);
        const info = trackInfo(trackId);
        snapshot();
        const closeMainKind = (kind) => {
          const audioOnly = kind === "audio" && !state.avLinked;
          const placed = audioOnly ? mainAudioClips() : mainClips();
          const map = kind === "audio" ? state.mainAudioTrackMap : state.mainVideoTrackMap;
          const onTrack = placed.filter((clip) =>
            trackId === kind ? !map?.[clip.id] : map?.[clip.id] === trackId,
          );
          console.log("[closeMainKind]", kind, "placed=", placed.length, "onTrack=", onTrack.length, "map=", JSON.stringify(map));
          console.log("[closeMainKind] gap=", gap.start.toFixed(3), "-", gap.end.toFixed(3), "dur=", gap.duration.toFixed(3));
          if (onTrack.length) {
            console.log("[closeMainKind] onTrack clips:", onTrack.map(c => `${c.id} [${c.start.toFixed(2)}-${c.end.toFixed(2)}]`));
          }
          if (!onTrack.length) return false;
          const closedOnTrack = closeTimelineGap(onTrack, gap);
          const allPlaced = placed.map(
            (clip) => closedOnTrack.find((item) => item.id === clip.id) || clip,
          );
          const packed = audioOnly
            ? buildPackedMainClips(
                Array.isArray(state.mainAudioRemovals) ? state.mainAudioRemovals : state.removals,
                Array.isArray(state.mainAudioManualCuts) ? state.mainAudioManualCuts : state.manualCuts,
                state.sourceDuration,
                state.audio.speed,
              )
            : baseMainClips();
          console.log("[closeMainKind] packed=", packed.length, "globalOffset=", state.mainTimelineOffset);
          console.log("[closeMainKind] closedOnTrack:", closedOnTrack.map(c => `${c.id} [${c.start.toFixed(2)}-${c.end.toFixed(2)}]`));
          const nextOffsets = offsetsFromPlaced(packed, allPlaced);
          console.log("[closeMainKind] nextOffsets=", JSON.stringify(nextOffsets));
          console.log("[closeMainKind] prevOffsets=", JSON.stringify(audioOnly ? state.mainAudioClipOffsets : state.mainVideoClipOffsets));
          if (audioOnly) state.mainAudioClipOffsets = nextOffsets;
          else {
            state.mainVideoClipOffsets = nextOffsets;
            if (state.avLinked) state.mainAudioClipOffsets = { ...nextOffsets };
          }
          return true;
        };
        console.log("[rippleDeleteGap] info=", JSON.stringify(info), "info.kind=", info.kind, "branch=", (info.kind === "video" || info.kind === "audio") ? "MAIN" : "OVERLAY");
        if (info.kind === "video" || info.kind === "audio") {
          const result = closeMainKind(info.kind);
          console.log("[rippleDeleteGap] closeMainKind returned=", result);
          if (state.avLinked || trackId === "video" || trackId === "audio")
            rippleShiftAllTracks(state, gap.end, -length);
        } else {
          const overlays =
            info.kind === "image"
              ? state.images
              : info.kind === "text"
                ? state.titles
                : info.kind === "caption"
                  ? state.captions
                  : trackId === "review"
                    ? state.reviewCaptions
                    : info.kind === "video"
                      ? state.videoLayers
                      : info.kind === "audio"
                        ? state.audioAssets
                        : [];
          const overlayType = trackId === "review" ? "review" : info.kind;
          rippleOverlayTrack(overlays, trackId, overlayType, gap.start, gap.end);
          if (trackId === "review")
            rippleOverlayTrack(state.issues, trackId, "review", gap.start, gap.end);
        }
        recomputeContentDuration();
        timelineGapSelection = null;
        state.selectedItems = [];
        seekTimeline(gap.start);
        renderAll();
        toast(`已波纹删除空白 ${length.toFixed(2)} 秒`);
      }
      function renderRuler() {
        const visibleDuration = visibleTimelineDuration();
        const width = Math.max(
            $("timelineScroll").clientWidth,
            visibleDuration * state.zoom,
          ),
          ruler = $("ruler");
        $("timelineContent").style.width = `${width}px`;
        if (ruler) ruler.style.width = `${width}px`;
        const plan = rulerTickPlan(state.zoom);
        let html = "";
        const rulerStep = Math.max(plan.micro, frameDuration());
        for (let t = 0; t <= visibleDuration + 0.0001; t += rulerStep) {
          const major = Math.abs(t / plan.major - Math.round(t / plan.major)) < 0.001;
          const minor = !major && Math.abs(t / plan.minor - Math.round(t / plan.minor)) < 0.001;
          const label = major
            ? plan.major >= 1
              ? formatTime(t, false)
              : formatTimecode(t).slice(3)
            : "";
          html += `<span class="tick${major ? "" : minor ? " minor" : " micro"}" style="left:${t * state.zoom}px">${label}</span>`;
        }
        for (const issue of state.issues)
          html += `<span class="marker ${issue.type}" data-issue="${issue.id}" title="${issue.label}" style="left:${issue.start * state.zoom}px"></span>`;
        for (const marker of state.timelineMarkers || [])
          html += `<span class="marker timeline-marker" data-timeline-marker="${escapeHtml(marker.id)}" title="${escapeHtml(marker.label || '时间线标记')} ${formatTimecode(Number(marker.time || 0))}" style="left:${Number(marker.time) * state.zoom}px"></span>`;
        ruler.innerHTML = html;
        syncTimelineChrome();
      }
      function trackBadgeText(key, meta) {
        if (key === "review") return "待处理";
        if (key === "caption") return "字幕";
        if (key === "video") return "视频 1";
        if (key === "audio") return "音频 1";
        if (meta?.label) return meta.label;
        const isVideoLike = ["video", "image", "text"].includes(meta?.kind || String(key).split("-")[0]);
        if (isVideoLike) {
          const videoTracks = (state.trackOrder || []).filter((id) => id === "video" || ["video", "image", "text"].includes(state.trackDefinitions?.[id]?.kind));
          const idx = videoTracks.indexOf(key);
          return idx >= 0 ? `视频 ${idx + 1}` : "视频";
        }
        if (meta?.kind === "audio" || String(key).startsWith("audio-")) {
          const audioTracks = (state.trackOrder || []).filter((id) => id === "audio" || state.trackDefinitions?.[id]?.kind === "audio");
          const idx = audioTracks.indexOf(key);
          return idx >= 0 ? `音频 ${idx + 1}` : "音频";
        }
        return meta?.label || "轨道";
      }
      function trackClipCountText(key) {
        let count = 0;
        if (key === "review") count = (state.reviewCaptions || []).length;
        else if (key === "caption") count = (state.captions || []).length;
        else if (key === "video") count = mainClips().length;
        else if (key === "audio") count = state.avLinked ? mainClips().length : mainAudioClips().length;
        else count = (trackItems(key) || []).length;
        return `${count} 个片段`;
      }
      function renderTrackOrder() {
        const labels = $("trackLabels"),
          content = $("timelineContent"),
          tail = content.querySelector("#timelineMarquee");
        labels.innerHTML = state.trackOrder
          .map((key) => {
            const meta = trackInfo(key),
              visible = state.trackVisibility[key] !== false,
              locked = isTrackLocked(key),
              soloed = !!state.trackSolo?.[key],
              autoSelected = isTrackAutoSelected(key),
              muted = !!state.trackMute?.[key],
              audioTrack = meta.kind === "audio";
            const symbol =
              key === "audio" ? (visible ? "🔊" : "🔇") : (visible ? "🎞" : "○");
            const remove = meta.deletable
              ? `<button class="trackdelete" data-delete-track="${key}" title="删除轨道">×</button>`
              : "";
            const badge = trackBadgeText(key, meta);
            const clipCount = trackClipCountText(key);
            const labelTitle = key === "review"
              ? "待处理片段：点击试听，Alt+点击替换为识别口播，Ctrl+点击保留，Shift+点击删除"
              : meta.label;
            return `<div class="tracklabel ${meta.className}" draggable="true" data-track-key="${key}"><div class="track-header-bar"><span class="trackhandle" title="拖动调整轨道顺序">⠿</span><span class="track-badge" title="${escapeHtml(labelTitle)}">${escapeHtml(badge)}</span><div class="track-controls"><button class="tracklock ${locked ? "on" : ""}" data-lock-track="${key}" title="${locked ? "解锁轨道" : "锁定轨道"}">${locked ? "🔒" : "🔓"}</button><button class="trackauto ${autoSelected ? "on" : ""}" data-auto-track="${key}" title="自动轨道选择器：决定选择后方、全选等命令是否作用于此轨">⇥</button>${audioTrack ? `<button class="tracksolo ${soloed ? "on" : ""}" data-solo-track="${key}" title="独听此轨">S</button><button class="trackmute ${muted ? "on" : ""}" data-mute-track="${key}" title="静音此轨">M</button><span class="audio-channel-tag">2.0</span>` : ""}<button class="visibility ${visible ? "" : "off"}" data-toggle-track="${key}" title="${visible ? "关闭轨道" : "显示轨道"}">${symbol}</button>${remove}</div></div><div class="track-info-body"><span class="track-title" title="${escapeHtml(labelTitle)}">${escapeHtml(meta.label)}</span><span class="track-clip-count">${clipCount}</span></div><span class="track-resize-grip" data-resize-track="${key}" title="按住拖动自由调节轨道高度；双击恢复默认高度"></span></div>`;
          })
          .join("");
        content.querySelectorAll(".trackrow[data-track-key]").forEach((row) => {
          if (!state.trackOrder.includes(row.dataset.trackKey)) row.remove();
        });
        for (const key of state.trackOrder) {
          let row = content.querySelector(
            `.trackrow[data-track-key="${key}"]`,
          );
          if (!row) {
            row = document.createElement("div");
            row.className = "trackrow";
            row.dataset.trackKey = key;
            row.id = `track-${key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
          }
          row.classList.toggle(
            "hidden-track",
            state.trackVisibility[key] === false,
          );
          row.classList.toggle("locked-track", isTrackLocked(key));
          row.classList.toggle("solo-muted", trackInfo(key).kind === "audio" && !isTrackAudible(key));
          const rowHeight = Math.max(40, Number(state.trackHeights?.[key] || 56));
          row.style.height = `${rowHeight}px`;
          if (tail) content.insertBefore(row, tail);
          else content.appendChild(row);
        }
        labels.querySelectorAll("[data-track-key]").forEach((label) => {
          const rowHeight = Math.max(40, Number(state.trackHeights?.[label.dataset.trackKey] || 56));
          label.style.height = `${rowHeight}px`;
          label.ondragstart = (event) => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData(
              "application/x-quickcut-track",
              label.dataset.trackKey,
            );
            label.classList.add("trackdrag");
          };
          label.ondragend = () => label.classList.remove("trackdrag");
          label.ondragover = (event) => {
            event.preventDefault();
            label.classList.add("drop-before");
          };
          label.ondragleave = () => label.classList.remove("drop-before");
          label.ondrop = (event) => {
            event.preventDefault();
            event.stopPropagation();
            const from = event.dataTransfer.getData(
                "application/x-quickcut-track",
              ),
              to = label.dataset.trackKey;
            if (!from || from === to) return;
            snapshot();
            state.trackOrder = state.trackOrder.filter((key) => key !== from);
            state.trackOrder.splice(state.trackOrder.indexOf(to), 0, from);
            renderAll();
          };
        });
        labels.querySelectorAll("[data-delete-track]").forEach((button) => {
          button.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            removeDynamicTrack(button.dataset.deleteTrack);
          };
        });
        labels.querySelectorAll("[data-lock-track]").forEach((button) => {
          button.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            const key = button.dataset.lockTrack;
            state.trackLocks ||= {};
            state.trackLocks[key] = !state.trackLocks[key];
            renderTrackOrder();
            updateSelectionBox();
            queueAutosave();
          };
        });
      }
      function renderTimeline() {
        renderTrackOrder();
        renderRuler();
        for (const key of state.trackOrder) {
          const row = $("timelineContent").querySelector(
              `.trackrow[data-track-key="${key}"]`,
            ),
            info = trackInfo(key);
          let html = "";
          let laneCount = 1;
          const videoClipMarkup = (clip, trackId) =>
            `<div class="clip video ${isSelected("video", clip.id) ? "selected" : ""}" data-type="video" data-id="${clip.id}" data-track-id="${trackId}" style="${clipGeometryStyle(clip)}"><i class="trim-handle start" data-trim="start"></i><span class="clip-sticky">${escapeHtml(state.video?.name || "视频")}</span><i class="trim-handle end" data-trim="end"></i></div>`;
          if (key === "video")
            html = mainClips()
              .filter((clip) => !state.mainVideoTrackMap?.[clip.id])
              .map((clip) => videoClipMarkup(clip, "video"))
              .join("");
          else if (key === "audio")
            html =
              mainAudioClips()
                .filter((clip) => !state.mainAudioTrackMap?.[clip.id])
                .map((clip) => audioClipHtml(clip, "audio", "audio"))
                .join("") +
              state.audioMutes
                .map(
                  (range) =>
                    `<div class="clip audiomute" title="静音区域" style="${clipGeometryStyle(range)}"></div>`,
                )
                .join("") +
              `<canvas class="wavecanvas" data-main-wave-track="audio" style="position:absolute;inset:0;z-index:25;pointer-events:none"></canvas>`;
          else if (info.kind === "video") {
            const mapped = mainClips()
              .filter((clip) => state.mainVideoTrackMap?.[clip.id] === key)
              .map((clip) => videoClipMarkup(clip, key))
              .join("");
            html = mapped + state.videoLayers
              .filter((clip) => clip.trackId === key)
              .map((clip) => clipHtml(clip, "videolayer"))
              .join("");
          } else if (info.kind === "audio") {
            const mapped = mainAudioClips()
              .filter((clip) => state.mainAudioTrackMap?.[clip.id] === key)
              .map((clip) => audioClipHtml(clip, "audio", key))
              .join("");
            html = mapped + state.audioAssets
              .filter((clip) => clip.trackId === key)
              .map((clip) => audioClipHtml(clip, "audioasset", key))
              .join("") + `<canvas class="wavecanvas" data-main-wave-track="${escapeHtml(key)}" style="position:absolute;inset:0;z-index:25;pointer-events:none"></canvas>`;
          } else {
            const type = info.kind;
            const items = trackItems(key);
            const stacked = assignOverlapLanes(items);
            laneCount = stacked.laneCount;
            html = items
              .map((clip) => {
                const lane = stacked.lanes.get(clip.id) || 0;
                return type === "audioasset"
                  ? audioClipHtml(clip, type, key, lane, laneCount)
                  : clipHtml(clip, type, lane, laneCount);
              })
              .join("");
          }
          const configuredHeight = Math.max(40, Number(state.trackHeights?.[key] || 56));
          const laneHeight = `${Math.max(configuredHeight, laneCount > 1 ? 6 + laneCount * 27 : 40)}px`;
          const gapSelection = timelineGapSelection?.trackId === key
            ? `<span class="timeline-gap-selection" data-selected-gap style="left:${timelineGapSelection.start * state.zoom}px;width:${Math.max(2, timelineGapSelection.duration * state.zoom)}px"></span>`
            : "";
          row.innerHTML = `${gapSelection}${html}`;
          row.style.width = $("timelineContent").style.width;
          row.style.height = laneHeight;
          if (laneCount === 1 && configuredHeight > 34)
            row.querySelectorAll(".clip").forEach((clip) => {
              clip.style.height = `${configuredHeight - 7}px`;
              clip.style.top = "3px";
            });
          const label = $("trackLabels").querySelector(`[data-track-key="${key}"]`);
          if (label) label.style.height = laneHeight;
        }
        syncTimelineChrome();
        syncTimelineRangeOverlay();
        drawWaveform();
        drawAssetWaveforms();
        $("durationLabel").textContent = formatTime(state.duration, false);
      }
      let timelineRenderFrame = 0,
        waveformRenderFrame = 0,
        previewRenderFrame = 0;
      function scheduleTimelineRender() {
        if (timelineRenderFrame) return;
        timelineRenderFrame = requestAnimationFrame(() => {
          timelineRenderFrame = 0;
          renderTimeline();
        });
      }
      function scheduleWaveformRender() {
        if (waveformRenderFrame) return;
        waveformRenderFrame = requestAnimationFrame(() => {
          waveformRenderFrame = 0;
          drawWaveform();
        });
      }
      function schedulePreviewRender(force = false) {
        if (previewRenderFrame) return;
        previewRenderFrame = requestAnimationFrame(() => {
          previewRenderFrame = 0;
          renderPreviewObjects(force);
        });
      }
      function updateTimelineClipGeometry(type, id, item) {
        const element = [...$("timelineContent").querySelectorAll(".clip[data-type][data-id]")]
          .find(
            (clip) => clip.dataset.type === type && clip.dataset.id === id,
          );
        if (!element || !item) return;
        element.style.left = `${Number(item.start || 0) * state.zoom}px`;
        element.style.width = `${Math.max(3, (Number(item.end || 0) - Number(item.start || 0)) * state.zoom)}px`;
      }
      function updateMainTimelineGeometry() {
        const clips = mainClips();
        for (const clip of clips) {
          updateTimelineClipGeometry("video", clip.id, clip);
        }
        for (const clip of mainAudioClips())
          updateTimelineClipGeometry("audio", clip.id, clip);
      }
      function applyMainTrackOverwrite(movingId, kind = "video") {
        if (!movingId) return;
        const audioOnly = kind === "audio" && !state.avLinked;
        const all = audioOnly ? mainAudioClips() : mainClips();
        const map = kind === "audio" ? state.mainAudioTrackMap : state.mainVideoTrackMap;
        const trackOf = (clip) =>
          map?.[clip.parentId || clip.id] || kind;
        const moving = all.find((clip) => clip.id === movingId || clip.parentId === movingId);
        if (!moving) return;
        const trackId = trackOf(moving);
        const onTrack = all.filter((clip) => trackOf(clip) === trackId);
        if (!onTrack.some((clip) => clip.id !== moving.id && clipsOverlapOnTrack(clip, moving)))
          return;
        const others = all.filter((clip) => trackOf(clip) !== trackId);
        const overwritten = [...overwriteOverlappingClips(onTrack, moving.id), ...others];
        const rebuilt = rebuildTimelineFromPlaced(
          overwritten,
          state.sourceDuration,
          state.audio.speed,
        );
        if (audioOnly) {
          state.mainAudioRemovals = rebuilt.removals;
          state.mainAudioManualCuts = rebuilt.manualCuts;
          state.mainAudioClipOffsets = rebuilt.offsets;
        } else {
          state.removals = rebuilt.removals;
          state.manualCuts = rebuilt.manualCuts;
          state.mainVideoClipOffsets = rebuilt.offsets;
          if (state.avLinked) state.mainAudioClipOffsets = { ...rebuilt.offsets };
          adoptClipMaps(all, rebuilt.packed);
        }
      }
      function applyOverlayTrackOverwrite(type, obj) {
        if (!obj || !["videolayer", "audioasset"].includes(type)) return;
        const list = type === "videolayer" ? state.videoLayers : state.audioAssets;
        const trackId = overlayTrackId(type, obj);
        const onTrack = list.filter((item) => overlayTrackId(type, item) === trackId);
        if (!onTrack.some((clip) => clip.id !== obj.id && clipsOverlapOnTrack(clip, obj))) return;
        const rest = list.filter((item) => overlayTrackId(type, item) !== trackId);
        const next = overwriteOverlappingClips(onTrack, obj.id).map((clip) =>
          String(clip.id).includes("__tail") ? { ...clip, id: uid() } : clip,
        );
        if (type === "videolayer") state.videoLayers = [...rest, ...next];
        else state.audioAssets = [...rest, ...next];
      }
      function updateVolumeGeometry(element, settings) {
        if (!element || !settings) return;
        const volume = settings.muted
          ? 0
          : clamp(Number(settings.volume ?? 1), 0, 2);
        element.style.setProperty("--wave-scale", Math.max(0.03, volume / 2));
        const line = element.querySelector("[data-volume-line]");
        if (line) line.style.top = `${clamp((1 - volume / 2) * 100, 0, 100)}%`;
      }
      function updateTransformInspector(object) {
        if (!object) return;
        $("objectScale").value = Math.round(Number(object.scale || 1) * 100);
        $("scaleOut").textContent = `${$("objectScale").value}%`;
        $("objectX").value = Math.round(Number(object.x || 0));
        $("objectY").value = Math.round(Number(object.y || 0));
        if ($("objectRotation")) {
          $("objectRotation").value = Math.round(Number(object.rotation || 0));
          $("rotationOut").textContent = `${$("objectRotation").value}°`;
          $("objectOpacity").value = Math.round(Number(object.opacity ?? 1) * 100);
          $("opacityOut").textContent = `${$("objectOpacity").value}%`;
          $("objectBlendMode").value = object.blendMode || "normal";
        }
      }
      