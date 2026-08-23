function scaleTimelineClipGeometry(ratio) {
        const content = $("timelineContent");
        if (!content || !Number.isFinite(ratio) || Math.abs(ratio - 1) < 1e-6) return;
        content.querySelectorAll(".clip, .timeline-gap-selection, .trackend, .audiomute").forEach((el) => {
          const left = parseFloat(el.style.left);
          if (Number.isFinite(left)) el.style.left = `${left * ratio}px`;
          const width = parseFloat(el.style.width);
          if (Number.isFinite(width)) el.style.width = `${width * ratio}px`;
        });
      }
      function setTimelineZoomAroundPlayhead(nextZoom, pointerClientX = null) {
        const scroll = $("timelineScroll");
        const oldZoom = Math.max(1, Number(state.zoom || 60));
        const playheadTime = clamp(Number(state.currentTime || 0), 0, visibleTimelineDuration());
        state.zoom = clamp(Number(nextZoom) || oldZoom, 1, 300);
        if ($("timelineZoom")) $("timelineZoom").value = state.zoom;
        if (!scroll) return;
        const content = $("timelineContent");
        const nextWidth = Math.max(scroll.clientWidth, visibleTimelineDuration() * state.zoom);
        if (content) content.style.width = `${nextWidth}px`;
        scroll.scrollLeft = playheadAnchoredScrollLeft({
          oldZoom,
          newZoom: state.zoom,
          playheadTime,
          scrollLeft: scroll.scrollLeft,
          viewWidth: scroll.clientWidth,
        });
        scaleTimelineClipGeometry(state.zoom / oldZoom);
        renderRuler();
        syncTimelineChrome();
        scheduleTimelineZoomCommit();
      }
      let timelineZoomCommitTimer = 0;
      function scheduleTimelineZoomCommit() {
        clearTimeout(timelineZoomCommitTimer);
        timelineZoomCommitTimer = setTimeout(() => {
          timelineZoomCommitTimer = 0;
          renderTimeline();
          scheduleWaveformRender();
        }, 120);
      }
      $("timelineZoom").oninput = (e) =>
        setTimelineZoomAroundPlayhead(Number(e.target.value));
      function zoomToFitTimeline() {
        const scroll = $("timelineScroll");
        if (!scroll) return;
        const totalDuration = Math.max(1, mainContentEnd() || state.duration || 60);
        const availableWidth = Math.max(100, scroll.clientWidth - 48);
        const fitZoom = clamp(Math.round((availableWidth / totalDuration) * 10) / 10, 1, 300);
        state.zoom = fitZoom;
        if ($("timelineZoom")) $("timelineZoom").value = fitZoom;
        const content = $("timelineContent");
        if (content) {
          const nextWidth = Math.max(scroll.clientWidth, visibleTimelineDuration() * state.zoom);
          content.style.width = `${nextWidth}px`;
        }
        scroll.scrollLeft = 0;
        syncTimelineChrome();
        renderTimeline();
        scheduleWaveformRender();
      }
      if ($("zoomToFitTimeline")) $("zoomToFitTimeline").onclick = zoomToFitTimeline;
      $("followPlayhead").onclick = () => {
        state.followPlayhead = state.followPlayhead === false;
        syncFollowPlayheadButton();
        if (state.followPlayhead !== false) keepPlayheadInView("center");
      };
      syncFollowPlayheadButton();
      let timelineDrag = null,
        objectDrag = null;
      function applyObjectDragMove(clientX, clientY) {
        if (!objectDrag) return;
        const frame = $("frame"),
          fw = objectDrag.frameWidth || (objectDrag.frameWidth = frame.clientWidth || 1),
          fh = objectDrag.frameHeight || (objectDrag.frameHeight = frame.clientHeight || 1);
        if (objectDrag.rotate) {
          const angle = (Math.atan2(clientY - objectDrag.centerY, clientX - objectDrag.centerX) * 180) / Math.PI;
          objectDrag.obj.rotation = objectDrag.rotation + angle - objectDrag.startAngle;
        } else if (objectDrag.widthResize) {
          const canvasZoom = Math.max(0.25, Number(state.canvasZoom || 1)),
            delta = ((clientX - objectDrag.startX) * state.width) / (fw * canvasZoom),
            signed = objectDrag.widthSide === "w" ? -delta : delta,
            textElement = state.selected.type === "caption"
              ? $("captionPreview")
              : frame.querySelector(`[data-type="text"][data-id="${state.selected.id}"]`),
            nextWidth = clamp(
              objectDrag.width + signed,
              objectDrag.minimumWidth || 160,
              state.width * 1.5,
            ),
            applied = nextWidth - objectDrag.width;
          objectDrag.obj.width = nextWidth;
          objectDrag.obj.x = objectDrag.x + (objectDrag.widthSide === "w" ? -applied / 2 : applied / 2);
          applyTextBoxWidth(textElement, nextWidth, fw / state.width);
          objectDrag.needsCaptionReflow = state.selected.type === "caption";
        } else if (objectDrag.resize) {
          const delta = (clientX - objectDrag.startX + clientY - objectDrag.startY) / 2;
          const sensitivity = state.selected.type === "video" ? 5.8 : 4.6;
          const factor = Math.exp(delta / Math.max(260, objectDrag.size * sensitivity));
          objectDrag.obj.scale = clamp(objectDrag.scale * factor, 0.05, 8);
        } else {
          const canvasZoom = Math.max(0.25, Number(state.canvasZoom || 1));
          objectDrag.obj.x = objectDrag.x + ((clientX - objectDrag.startX) * state.width) / (fw * canvasZoom);
          objectDrag.obj.y = objectDrag.y + ((clientY - objectDrag.startY) * state.height) / (fh * canvasZoom);
          const snapThreshold = (9 * state.width) / Math.max(1, fw * canvasZoom);
          const centered = Math.abs(Number(objectDrag.obj.x || 0)) <= snapThreshold;
          if (centered) objectDrag.obj.x = 0;
          $("centerGuide").classList.toggle("on", centered);
        }
        const selectedElement = state.selected.type === "caption"
          ? $("captionPreview")
          : state.selected.type === "video"
            ? $("video")
            : frame.querySelector(`[data-type="${state.selected.type}"][data-id="${state.selected.id}"]`);
        if (selectedElement) {
          const px = fw / state.width, py = fh / state.height;
          let transform = "none";
          if (state.selected.type === "video")
            transform = `translate(${Number(objectDrag.obj.x || 0) * px}px,${Number(objectDrag.obj.y || 0) * py}px) rotate(${Number(objectDrag.obj.rotation || 0)}deg) scale(${Number(objectDrag.obj.scale || 1)})`;
          else
            transform = `translate(calc(-50% + ${Number(objectDrag.obj.x || 0) * px}px),calc(-50% + ${Number(objectDrag.obj.y || 0) * py}px)) rotate(${Number(objectDrag.obj.rotation || 0)}deg) scale(${Number(objectDrag.obj.scale || 1)})`;
          selectedElement.style.transform = transform;
          if (state.selected.type === "video") $("beautyPreviewCanvas").style.transform = transform;
          $("selectionBox").style.transform = transform;
          if (objectDrag.widthResize)
            $("selectionBox").style.width = `${objectDrag.obj.width * (fw / state.width)}px`;
        }
        // Inspector fields and caption word DOM are committed on pointerup.
        // During a drag only compositor-friendly transform/width properties
        // are changed.
      }
      function scheduleObjectDragMove(clientX, clientY) {
        if (!objectDrag) return;
        objectDrag.pendingX = clientX;
        objectDrag.pendingY = clientY;
        if (objectDrag.framePending) return;
        objectDrag.framePending = requestAnimationFrame(() => {
          if (!objectDrag) return;
          objectDrag.framePending = 0;
          applyObjectDragMove(objectDrag.pendingX, objectDrag.pendingY);
        });
      }
      let rulerScrub = null,
        rulerScrubFrame = 0,
        rulerScrubTime = 0,
        rulerScrubLastSeek = 0;
      function scheduleRulerScrub(clientX) {
        const rect = ($("ruler") || $("timelineContent")).getBoundingClientRect();
        rulerScrubTime = clamp(
          (clientX - rect.left) / state.zoom,
          0,
          visibleTimelineDuration(),
        );
        if (rulerScrubFrame) return;
        rulerScrubFrame = requestAnimationFrame(() => {
          rulerScrubFrame = 0;
          const now = performance.now();
          if (now - rulerScrubLastSeek < 30) return;
          rulerScrubLastSeek = now;
          seekTimeline(rulerScrubTime);
        });
      }
      $("ruler").onpointerdown = (event) => {
        const timelineMarker = event.target.closest("[data-timeline-marker]");
          if (timelineMarker) {
            const m = (state.timelineMarkers || []).find((item) => item.id === timelineMarker.dataset.timelineMarker);
            if (m) seekTimeline(Number(m.time || 0));
            return;
          }
          const marker = event.target.closest("[data-issue]");
        if (marker) {
          selectIssue(marker.dataset.issue);
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        rulerScrub = { pointer: event.pointerId };
        event.currentTarget.setPointerCapture?.(event.pointerId);
        scheduleRulerScrub(event.clientX);
        event.preventDefault();
        event.stopPropagation();
      };
      window.addEventListener("pointermove", (event) => {
        if (!rulerScrub || rulerScrub.pointer !== event.pointerId) return;
        scheduleRulerScrub(event.clientX);
      });
      window.addEventListener("pointerup", (event) => {
        if (!rulerScrub || rulerScrub.pointer !== event.pointerId) return;
        scheduleRulerScrub(event.clientX);
        rulerScrub = null;
        syncPreviewAudio();
      });
      $("timelineContent").onpointerdown = (e) => {
        if (e.button === 2) return; // 右键不启动拖拽/框选，由 contextmenu 处理
        const insertReview = e.target.closest("[data-insert-review]");
        if (insertReview) {
          if (isTrackLocked("review")) {
            toast("待处理片段轨道已锁定");
            return;
          }
          insertReviewSegment(insertReview.dataset.insertReview);
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        const cutReview = e.target.closest("[data-cut-review]");
        if (cutReview) {
          if (!applyRedReviewGesture(e, cutReview.dataset.cutReview))
            previewReviewSegment(cutReview.dataset.cutReview);
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        const reviewApply = e.target.closest(
          "[data-apply-review],[data-replace-review]",
        );
        if (reviewApply) {
          replaceReviewCaption(
            reviewApply.dataset.applyReview || reviewApply.dataset.replaceReview,
          );
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        const focusIssue = e.target.closest("[data-focus-issue]");
        if (focusIssue) {
          focusScriptDifference(focusIssue.dataset.focusIssue);
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        const scriptAction = e.target.closest("[data-script-action]");
        if (scriptAction) {
          const issueId = scriptAction.dataset.scriptIssue;
          if (scriptAction.dataset.scriptAction === "cut") {
            if (!applyRedReviewGesture(e, issueId))
              focusScriptDifference(issueId);
          } else focusScriptDifference(issueId);
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        const clip = e.target.closest(".clip");
        if (clip) {
          timelineGapSelection = null;
          if (editTool === "blade") {
            const guided = Number($("bladeGuide")?.dataset.time);
            const time = Number.isFinite(guided)
              ? guided
              : previewBladeTime(e.clientX);
            seekTimeline(time);
            setBladeGuide(time, true);
            if (!splitClipsAt(time, [{ type: clip.dataset.type, id: clip.dataset.id }]))
              toast("点在片段中部切割");
            e.preventDefault();
            return;
          }
          const additive = e.shiftKey || e.metaKey || e.ctrlKey;
          selectItem(
            clip.dataset.type,
            clip.dataset.id,
            additive,
            e.metaKey || e.ctrlKey,
          );
          if (isTrackLocked(clip.dataset.trackId || selectionTrackId(clip.dataset.type, clip.dataset.id))) {
            renderTimeline();
            renderPreviewObjects();
            updateInspector();
            toast("这个轨道已锁定，请先解锁后再编辑");
            e.preventDefault();
            return;
          }
          const selectedTimelineObject = timelineObjectFor(
            clip.dataset.type,
            clip.dataset.id,
          );
          const selectedMainClip = clip.dataset.type === "video"
            ? mainClips().find((item) => item.id === clip.dataset.id)
            : clip.dataset.type === "audio"
              ? mainAudioClips().find((item) => item.id === clip.dataset.id)
              : null;
          if (selectedTimelineObject)
            includeLinkedSelection(clip.dataset.type, clip.dataset.id);
          else if (selectedMainClip)
            includeLinkedSelection(clip.dataset.type, clip.dataset.id);
          if (state.avLinked && ["videolayer", "audioasset"].includes(clip.dataset.type)) {
            const selectedObject = timelineObjectFor(clip.dataset.type, clip.dataset.id);
            const linked = selectedObject?.linkGroupId
              ? [...state.videoLayers, ...state.audioAssets].find(
                  (item) => item !== selectedObject && item.linkGroupId === selectedObject.linkGroupId,
                )
              : null;
            if (linked) {
              const linkedType = state.videoLayers.includes(linked) ? "videolayer" : "audioasset";
              if (!state.selectedItems.some((item) => item.type === linkedType && item.id === linked.id))
                state.selectedItems.push({ type: linkedType, id: linked.id });
            }
          }
          if (clip.dataset.type === "review") {
            if (clip.dataset.cutReview) {
              if (!applyRedReviewGesture(e, clip.dataset.cutReview))
                previewReviewSegment(clip.dataset.cutReview);
            } else if (clip.dataset.insertReview) {
              if (isTrackLocked("review")) toast("待处理片段轨道已锁定");
              else insertReviewSegment(clip.dataset.insertReview);
            } else {
              selectIssue(clip.dataset.focusIssue || clip.dataset.id);
              renderTimeline();
            }
            e.preventDefault();
            return;
          }
          const volumeLine = e.target.closest("[data-volume-line]");
          if (volumeLine && ["audio", "audioasset"].includes(clip.dataset.type)) {
            const settings = audioSettingsFor(clip.dataset.type, clip.dataset.id);
            if (settings) {
              snapshot();
              timelineDrag = {
                pointer: e.pointerId,
                volumeSettings: settings,
                volumeRow: clip,
                element: clip,
              };
            }
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          const trimHandle = e.target.closest("[data-trim]");
          if (trimHandle) {
            const object = timelineObjectFor(clip.dataset.type, clip.dataset.id);
            const mainClip = clip.dataset.type === "video"
              ? mainClips().find((item) => item.id === clip.dataset.id)
              : clip.dataset.type === "audio"
                ? mainAudioClips().find((item) => item.id === clip.dataset.id)
                : null;
            const mainTrimClip = mainClip && clip.dataset.type === "audio" && !state.avLinked
              ? baseMainAudioClips().find((item) => item.id === mainClip.parentId) || mainClip
              : mainClip;
            if (object || mainTrimClip) {
              snapshot();
              const trimSnapshot = clip.dataset.type === "audio" && !state.avLinked
                ? baseMainAudioClips()
                : mainClips();
              const mainIndex = mainTrimClip
                ? trimSnapshot.findIndex((item) => item.id === mainTrimClip.id || item.id === mainTrimClip.parentId)
                : -1;
              const rollLeft = trimHandle.dataset.trim === "end"
                ? trimSnapshot[mainIndex]
                : trimSnapshot[mainIndex - 1];
              const rollRight = trimHandle.dataset.trim === "end"
                ? trimSnapshot[mainIndex + 1]
                : trimSnapshot[mainIndex];
              const rollEdit = editTool === "trim" && e.shiftKey && rollLeft && rollRight
                ? { left: { ...rollLeft }, right: { ...rollRight }, cutSource: Number(rollLeft.sourceEnd || 0) }
                : null;
              timelineDrag = {
                pointer: e.pointerId,
                element: clip,
                trim: true,
                trimEdge: trimHandle.dataset.trim,
                trimType: clip.dataset.type,
                trimObject: object,
                mainTrimClip,
                rollEdit,
                isRipple: editTool === "trim",
                mainClipsSnapshot: trimSnapshot.map((c) => ({
                  id: c.id,
                  start: Number(c.start),
                  end: Number(c.end),
                  sourceStart: Number(c.sourceStart),
                  sourceEnd: Number(c.sourceEnd),
                })),
                startX: e.clientX,
                originStart: Number((object || mainTrimClip).start),
                originEnd: Number((object || mainTrimClip).end),
                originSourceStart: Number(object?.sourceStart || 0),
              };
            }
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          const movable = expandLinkedSelection(state.selectedItems || [])
            .map((item) => ({
              ...item,
              obj: timelineObjectFor(item.type, item.id),
            }))
            .filter((item) => item.obj)
            .map((item) => ({
              ...item,
              originStart: item.obj.start,
              originEnd: item.obj.end,
            }));
          const obj = timelineObjectFor(clip.dataset.type, clip.dataset.id);
          if (
            obj &&
            ["videolayer", "audioasset", "image", "text", "caption", "review"].includes(
              clip.dataset.type,
            )
          ) {
            snapshot();
            timelineDrag = {
              pointer: e.pointerId,
              element: clip,
              startX: e.clientX,
              startY: e.clientY,
              moving: movable,
              slip: editTool === "trim" && e.altKey && ["videolayer", "audioasset"].includes(clip.dataset.type),
              slipOriginSourceStart: Number(obj.sourceStart || 0),
              slipSourceDuration: Number(obj.sourceDuration || obj.duration || 0),
            };
          } else if (["video", "audio"].includes(clip.dataset.type)) {
            const sourceClip = (clip.dataset.type === "video"
              ? mainClips()
              : mainAudioClips()
            ).find((item) => item.id === clip.dataset.id);
            if (sourceClip) {
              snapshot();
              const moveIds = collectMainMoveIds(clip.dataset.type, sourceClip.id);
              const movingMains = [];
              for (const id of moveIds) {
                const video = mainClips().find((item) => item.id === id);
                if (video) {
                  movingMains.push({
                    id: video.id,
                    type: "video",
                    originStart: Number(video.start || 0),
                    originOffset: Number(state.mainVideoClipOffsets?.[video.id] || 0),
                  });
                }
                if (!state.avLinked) {
                  const audio = mainAudioClips().find(
                    (item) => item.id === id || item.parentId === id,
                  );
                  if (audio)
                    movingMains.push({
                      id: audio.parentId || audio.id,
                      type: "audio",
                      originStart: Number(audio.start || 0),
                      originOffset: Number(
                        state.mainAudioClipOffsets?.[audio.parentId || audio.id] || 0,
                      ),
                    });
                }
              }
              if (state.avLinked && !movingMains.some((item) => item.id === sourceClip.id))
                movingMains.push({
                  id: sourceClip.id,
                  type: "video",
                  originStart: Number(sourceClip.start || 0),
                  originOffset: Number(state.mainVideoClipOffsets?.[sourceClip.id] || 0),
                });
              timelineDrag = {
                pointer: e.pointerId,
                element: clip,
                startX: e.clientX,
                startY: e.clientY,
                mainTrackMove: true,
                mainTrackType: clip.dataset.type,
                mainTrackClip: sourceClip,
                originClipStart: Number(sourceClip.start || 0),
                originClipOffset: Number(
                  (clip.dataset.type === "audio"
                    ? state.mainAudioClipOffsets
                    : state.mainVideoClipOffsets)?.[sourceClip.parentId || sourceClip.id] || 0,
                ),
                movingMains,
                linkedMoving: expandLinkedSelection(state.selectedItems || [])
                  .map((item) => ({
                    ...item,
                    obj: timelineObjectFor(item.type, item.id),
                  }))
                  .filter((item) => item.obj)
                  .map((item) => ({
                    ...item,
                    originStart: Number(item.obj.start || 0),
                    originEnd: Number(item.obj.end || 0),
                  })),
              };
            }
          }
          updateInspector();
          renderTimeline();
          renderPreviewObjects();
          e.preventDefault();
          return;
        }
        if (editTool === "blade") {
          const time = previewBladeTime(e.clientX);
          seekTimeline(time);
          setBladeGuide(time, true);
          e.preventDefault();
          return;
        }
        const rect = $("timelineContent").getBoundingClientRect();
        const row = e.target.closest(".trackrow[data-track-key]");
        const gapTime = (e.clientX - rect.left) / Math.max(1e-6, state.zoom);
        const gapCandidate = row
          ? findTimelineGap(timelineGapItems(row.dataset.trackKey), gapTime)
          : null;
        if (!(e.shiftKey || e.metaKey || e.ctrlKey)) {
          state.selectedItems = [];
          state.selected = { type: "video", id: "main" };
        }
        timelineDrag = {
          pointer: e.pointerId,
          marquee: true,
          additive: e.shiftKey || e.metaKey || e.ctrlKey,
          startX: e.clientX,
          startY: e.clientY,
          contentX: e.clientX - rect.left,
          contentY: e.clientY - rect.top,
          gapCandidate: gapCandidate
            ? { trackId: row.dataset.trackKey, ...gapCandidate }
            : null,
          moved: false,
        };
        e.preventDefault();
      };
      function autoScrollTimelineDuringDrag(clientX) {
        if (!timelineDrag || timelineDrag.marquee) return;
        const scroll = $("timelineScroll"); if (!scroll) return;
        if (!Number.isFinite(timelineDrag.originScrollLeft)) timelineDrag.originScrollLeft = scroll.scrollLeft;
        const rect = scroll.getBoundingClientRect(), edge = Math.min(88, Math.max(48, rect.width * 0.075));
        let velocity = 0;
        if (clientX < rect.left + edge) velocity = -Math.pow((rect.left + edge - clientX) / edge, 1.35) * 22;
        else if (clientX > rect.right - edge) velocity = Math.pow((clientX - (rect.right - edge)) / edge, 1.35) * 22;
        if (velocity) scroll.scrollLeft = Math.max(0, scroll.scrollLeft + velocity);
      }
      function beginTimelineGesture() {
        if (!timelineGestureBefore) timelineGestureBefore = JSON.stringify(projectData());
      }
      function commitTimelineGesture() {
        if (!timelineGestureBefore) return false;
        const before = timelineGestureBefore; timelineGestureBefore = null;
        if (JSON.stringify(projectData()) === before) return false;
        state.undo.push(before); state.redo = [];
        if (state.undo.length > 30) state.undo.shift();
        queueAutosave(); return true;
      }
      function rollbackTimelineGesture() {
        if (!timelineGestureBefore) return;
        const before = timelineGestureBefore; timelineGestureBefore = null;
        applyHistoryState(JSON.parse(before));
      }
      document.addEventListener("pointermove", (e) => {
        if (editTool === "blade" && !timelineDrag && e.target.closest?.("#timelineMain"))
          setBladeGuide(previewBladeTime(e.clientX), true);
        if (timelineDrag?.pointer === e.pointerId) {
          autoScrollTimelineDuringDrag(e.clientX);
          if (timelineDrag.marquee) {
            const rect = $("timelineContent").getBoundingClientRect();
            const x = e.clientX - rect.left,
              y = e.clientY - rect.top,
              left = Math.min(timelineDrag.contentX, x),
              top = Math.min(timelineDrag.contentY, y),
              width = Math.abs(x - timelineDrag.contentX),
              height = Math.abs(y - timelineDrag.contentY),
              marquee = $("timelineMarquee");
            timelineDrag.moved = width > 4 || height > 4;
            marquee.style.left = `${left}px`;
            marquee.style.top = `${top}px`;
            marquee.style.width = `${width}px`;
            marquee.style.height = `${height}px`;
            marquee.classList.toggle("on", timelineDrag.moved);
          } else if (timelineDrag.volumeSettings) {
            const rect = timelineDrag.volumeRow.getBoundingClientRect();
            const ratio = clamp((e.clientY - rect.top) / rect.height, 0, 1);
            timelineDrag.volumeSettings.volume = Math.round((1 - ratio) * 200) / 100;
            timelineDrag.volumeSettings.muted = false;
            updateVolumeGeometry(
              timelineDrag.element,
              timelineDrag.volumeSettings,
            );
            scheduleWaveformRender();
            syncAudioControls();
          } else if (timelineDrag.slip && timelineDrag.moving?.[0]?.obj) {
            const moving = timelineDrag.moving[0];
            const object = moving.obj;
            const deltaSource = (e.clientX - timelineDrag.startX) / state.zoom * Math.max(.05, Number(state.audio.speed || 1));
            const duration = Math.max(.04, Number(object.end || 0) - Number(object.start || 0)) * Math.max(.05, Number(state.audio.speed || 1));
            const slipped = slipClipSource(
              { sourceStart: timelineDrag.slipOriginSourceStart, sourceEnd: timelineDrag.slipOriginSourceStart + duration },
              deltaSource,
              0,
              Math.max(duration, timelineDrag.slipSourceDuration || duration),
            );
            object.sourceStart = slipped.sourceStart;
            timelineDrag.moved = Math.abs(deltaSource) > .001;
            if (moving.type === "audioasset" && object.waveform?.length)
              showTrimAudioDetail({
                waveform: object.waveform,
                sourceDuration: object.sourceDuration || object.duration,
                sourceTime: object.sourceStart + duration / 2,
                delta: object.sourceStart - timelineDrag.slipOriginSourceStart,
                mode: "Slip 滑移片段内容",
              });
            drawAssetWaveforms();
          } else if (timelineDrag.trim) {
            const delta = (e.clientX - timelineDrag.startX) / state.zoom;
            const edge = timelineDrag.trimEdge;
            if (timelineDrag.trimObject) {
              const object = timelineDrag.trimObject;
              const isMedia = ["videolayer", "audioasset"].includes(
                timelineDrag.trimType,
              );
              if (edge === "start") {
                const minStart = isMedia
                  ? Math.max(
                      0,
                      timelineDrag.originStart -
                        timelineDrag.originSourceStart /
                          Math.max(0.5, Number(state.audio.speed || 1)),
                    )
                  : 0;
                object.start = snapTime(
                  clamp(
                    timelineDrag.originStart + delta,
                    minStart,
                    timelineDrag.originEnd - 0.04,
                  ),
                  object,
                );
                if (isMedia)
                  object.sourceStart = Math.max(
                    0,
                    timelineDrag.originSourceStart +
                      (object.start - timelineDrag.originStart) *
                        Math.max(0.5, Number(state.audio.speed || 1)),
                  );
              } else {
                const maxEnd = isMedia
                  ? timelineDrag.originStart +
                    (Math.max(
                      timelineDrag.originSourceStart + 0.04,
                      Number(object.sourceDuration ||
                        timelineDrag.originSourceStart +
                          timelineDrag.originEnd - timelineDrag.originStart),
                    ) - timelineDrag.originSourceStart) /
                      Math.max(0.5, Number(state.audio.speed || 1))
                  : visibleTimelineDuration() + 3600;
                object.end = snapTime(
                  clamp(
                    timelineDrag.originEnd + delta,
                    object.start + 0.04,
                    maxEnd,
                  ),
                  object,
                );
                state.timelineDuration = Math.max(
                  state.timelineDuration,
                  object.end + 10,
                );
              }
              if (state.avLinked && object.linkGroupId) {
                const linked = [...state.videoLayers, ...state.audioAssets].find(
                  (item) => item !== object && item.linkGroupId === object.linkGroupId,
                );
                if (linked) {
                  linked.start = object.start;
                  linked.end = object.end;
                  linked.sourceStart = object.sourceStart;
                  const linkedType = state.videoLayers.includes(linked)
                    ? "videolayer"
                    : "audioasset";
                  updateTimelineClipGeometry(linkedType, linked.id, linked);
                }
              }
              updateTimelineClipGeometry(
                timelineDrag.trimType,
                object.id,
                object,
              );
              if (timelineDrag.trimType === "audioasset" && object.waveform?.length) {
                const edgeTime = edge === "start" ? object.sourceStart :
                  Number(object.sourceStart || 0) + (object.end - object.start) * Math.max(.05, Number(state.audio.speed || 1));
                showTrimAudioDetail({
                  waveform: object.waveform,
                  sourceDuration: object.sourceDuration || object.duration,
                  sourceTime: edgeTime,
                  delta: (edge === "start" ? object.start - timelineDrag.originStart : object.end - timelineDrag.originEnd),
                  mode: timelineDrag.isRipple ? "波纹修剪 · 音频" : "修剪 · 音频",
                });
              }
            } else if (timelineDrag.rollEdit) {
              const speed = Math.max(.05, Number(state.audio.speed || 1));
              const roll = timelineDrag.rollEdit;
              const deltaTimeline = (e.clientX - timelineDrag.startX) / state.zoom;
              const minCut = Number(roll.left.sourceStart || 0) + frameDuration() * speed;
              const maxCut = Number(roll.right.sourceEnd || 0) - frameDuration() * speed;
              roll.targetSource = clamp(roll.cutSource + deltaTimeline * speed, minCut, maxCut);
              const applied = (roll.targetSource - roll.cutSource) / speed;
              const cutTime = Number(roll.left.end || 0) + applied;
              const leftElement = $("timelineContent").querySelector(`.clip[data-type="${timelineDrag.trimType}"][data-id="${roll.left.id}"]`);
              const rightElement = $("timelineContent").querySelector(`.clip[data-type="${timelineDrag.trimType}"][data-id="${roll.right.id}"]`);
              if (leftElement) leftElement.style.width = `${Math.max(3, (cutTime - Number(roll.left.start || 0)) * state.zoom)}px`;
              if (rightElement) {
                const rightEnd = Number(roll.right.end || cutTime);
                rightElement.style.left = `${cutTime * state.zoom}px`;
                rightElement.style.width = `${Math.max(3, (rightEnd - cutTime) * state.zoom)}px`;
              }
              showTrimAudioDetail({
                waveform: state.waveform,
                sourceDuration: state.sourceDuration,
                sourceTime: roll.targetSource,
                delta: applied,
                mode: "Roll 滾動編輯（總時長不變）",
              });
            } else if (timelineDrag.mainTrimClip) {
              const clip = timelineDrag.mainTrimClip;
              const speed = Math.max(0.05, Number(state.audio.speed || 1));
              const sourceBounds = mainTrimSourceBounds({
                removals: timelineDrag.trimType === "audio" && !state.avLinked
                  ? state.mainAudioRemovals
                  : state.removals,
                clip,
                edge,
                snapshot: timelineDrag.mainClipsSnapshot || [],
                mode: timelineDrag.isRipple ? "ripple" : "trim",
                speed,
              });
              const originTimeline = edge === "start"
                ? timelineDrag.originStart
                : timelineDrag.originEnd;
              const originSource = edge === "start"
                ? Number(clip.sourceStart || 0)
                : Number(clip.sourceEnd || 0);
              const minTimeline = originTimeline + (sourceBounds.min - originSource) / speed;
              const maxTimeline = originTimeline + (sourceBounds.max - originSource) / speed;
              const rawTime = clamp(
                originTimeline + delta,
                minTimeline,
                maxTimeline,
              );
              timelineDrag.mainTrimTime = clamp(
                snapTime(rawTime, clip, {
                  min: minTimeline,
                  max: maxTimeline,
                  excludeTimes: [originTimeline],
                }),
                minTimeline,
                maxTimeline,
              );
              showTrimAudioDetail({
                waveform: state.waveform,
                sourceDuration: state.sourceDuration,
                sourceTime: originSource + (timelineDrag.mainTrimTime - originTimeline) * speed,
                delta: timelineDrag.mainTrimTime - originTimeline,
                mode: timelineDrag.isRipple ? "波纹修剪" : "选择修剪",
              });
              const appliedDelta = timelineDrag.mainTrimTime - originTimeline;
              let start, end;
              if (timelineDrag.isRipple && edge === "start") {
                start = timelineDrag.originStart;
                end = Math.max(start + 0.04, timelineDrag.originEnd - appliedDelta);
              } else {
                start = edge === "start"
                  ? timelineDrag.mainTrimTime
                  : timelineDrag.originStart;
                end = edge === "end"
                  ? timelineDrag.mainTrimTime
                  : timelineDrag.originEnd;
              }
              if (timelineDrag.element) {
                timelineDrag.element.style.left = `${start * state.zoom}px`;
                timelineDrag.element.style.width = `${Math.max(3, (end - start) * state.zoom)}px`;
              }
            }
            // Preview media seeking is deferred to pointerup; clip geometry
            // remains immediate and smooth while trimming.
          } else {
            if (timelineDrag.mainTrackMove) {
              const delta = (e.clientX - timelineDrag.startX) / state.zoom;
              const length =
                timelineDrag.mainTrackClip.end - timelineDrag.mainTrackClip.start;
              const nextStart = snapClipStart(
                Math.max(0, timelineDrag.originClipStart + delta),
                length,
                timelineDrag.mainTrackClip,
              );
              const appliedDelta = nextStart - timelineDrag.originClipStart;
              const movers = timelineDrag.movingMains?.length
                ? timelineDrag.movingMains
                : [{
                    id: timelineDrag.mainTrackClip.parentId || timelineDrag.mainTrackClip.id,
                    type: timelineDrag.mainTrackType,
                    originOffset: timelineDrag.originClipOffset,
                  }];
              for (const mover of movers) {
                const nextOffset = Number(mover.originOffset || 0) + appliedDelta;
                if (mover.type === "video") {
                  state.mainVideoClipOffsets[mover.id] = nextOffset;
                  if (state.avLinked) state.mainAudioClipOffsets[mover.id] = nextOffset;
                } else if (mover.type === "audio") {
                  state.mainAudioClipOffsets[mover.id] = nextOffset;
                  if (state.avLinked) state.mainVideoClipOffsets[mover.id] = nextOffset;
                }
              }
              for (const item of timelineDrag.linkedMoving || []) {
                item.obj.start = Math.max(0, item.originStart + appliedDelta);
                item.obj.end = Math.max(
                  item.obj.start + 0.002,
                  item.originEnd + appliedDelta,
                );
                updateTimelineClipGeometry(item.type, item.id, item.obj);
              }
              timelineDrag.horizontalMoved =
                Math.abs(appliedDelta) > 0.002;
              updateMainTimelineGeometry();
              return;
            }
            const delta = (e.clientX - timelineDrag.startX) / state.zoom;
            const moving = timelineDrag.moving || [];
            const anchor = moving[0];
            const appliedDelta = (() => {
              if (!anchor) return delta;
              const rawStart = clamp(
                anchor.originStart + delta,
                0,
                Math.max(
                  0,
                  visibleTimelineDuration() -
                    (anchor.originEnd - anchor.originStart),
                ),
              );
              const rawDelta = rawStart - anchor.originStart;
              if (!state.snapping) {
                hideSnapGuide();
                return rawDelta;
              }
              const group = snapGroupDelta(
                moving,
                rawDelta,
                currentSnapPoints(moving),
                snapThresholdSeconds(),
              );
              showSnapGuide(group.target, group.snapped);
              const minStart = Math.min(...moving.map((item) => Number(item.originStart || 0)));
              return minStart + group.delta < 0 ? -minStart : group.delta;
            })();
            for (const item of moving) {
              const length = item.originEnd - item.originStart;
              item.obj.start = clamp(
                item.originStart + appliedDelta,
                0,
                Math.max(0, visibleTimelineDuration() - length),
              );
              item.obj.end = item.obj.start + length;
              updateTimelineClipGeometry(item.type, item.id, item.obj);
            }
          }
        }
        if (objectDrag?.pointer === e.pointerId) {
          scheduleObjectDragMove(e.clientX, e.clientY);
        }
      });
      document.addEventListener("pointerup", (e) => {
        if (timelineDrag?.pointer === e.pointerId) {
          hideTrimAudioDetail();
          hideSnapGuide();
          if (timelineDrag.marquee) {
            $("timelineMarquee").classList.remove("on");
            if (timelineDrag.moved) {
              const left = Math.min(timelineDrag.startX, e.clientX),
                right = Math.max(timelineDrag.startX, e.clientX),
                top = Math.min(timelineDrag.startY, e.clientY),
                bottom = Math.max(timelineDrag.startY, e.clientY),
                contentRect = $("timelineContent").getBoundingClientRect(),
                range = {
                  start: (left - contentRect.left) / Math.max(1e-6, state.zoom),
                  end: (right - contentRect.left) / Math.max(1e-6, state.zoom),
                },
                hits = [...$("timelineContent").querySelectorAll(".clip[data-type][data-id]")]
                  .filter((clip) => {
                    const rect = clip.getBoundingClientRect();
                    return rect.right >= left && rect.left <= right && rect.bottom >= top && rect.top <= bottom;
                  })
                  .map((clip) => ({ type: clip.dataset.type, id: clip.dataset.id }));
              const merged = timelineDrag.additive
                ? [...(state.selectedItems || []), ...hits]
                : hits;
              state.selectedItems = expandLinkedSelection(
                [...new Map(merged.map((item) => [selectionKey(item.type, item.id), item])).values()],
              );
              state.selected = state.selectedItems.at(-1) || { type: "video", id: "main" };
              renderTimeline();
              renderPreviewObjects();
              updateInspector();
            } else {
              const rect = $("timelineContent").getBoundingClientRect();
              seekTimeline((e.clientX - rect.left) / state.zoom);
              timelineGapSelection = timelineDrag.gapCandidate
                ? { ...timelineDrag.gapCandidate }
                : null;
              renderTimeline();
            }
          }
          if (timelineDrag.rollEdit && Number.isFinite(timelineDrag.rollEdit.targetSource)) {
            const roll = timelineDrag.rollEdit;
            const audioOnly = timelineDrag.trimType === "audio" && !state.avLinked;
            const previous = audioOnly ? mainAudioClips() : mainClips();
            const committed = rollingEditMainClips(
              audioOnly ? state.mainAudioRemovals : state.removals,
              audioOnly ? state.mainAudioManualCuts : state.manualCuts,
              roll.left,
              roll.right,
              roll.targetSource,
            );
            if (audioOnly) {
              state.mainAudioRemovals = committed.removals;
              state.mainAudioManualCuts = committed.manualCuts;
              adoptMainAudioMaps(previous);
            } else {
              state.removals = committed.removals;
              state.manualCuts = committed.manualCuts;
              normalizeRemovals();
              adoptClipMaps(previous, mainClips());
            }
            recomputeContentDuration();
            renderAll();
          }
          if (timelineDrag.trim && timelineDrag.trimObject && timelineDrag.isRipple) {
            const object = timelineDrag.trimObject;
            const originStart = Number(timelineDrag.originStart);
            const originEnd = Number(timelineDrag.originEnd);
            const delta = (Number(object.end) - Number(object.start)) - (originEnd - originStart);
            if (Math.abs(delta) > 0.001) {
              const type = timelineDrag.trimType;
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
              const trackId = overlayTrackId(type, object);
              const from = timelineDrag.trimEdge === "start"
                ? originStart
                : Math.min(originEnd, Number(object.end));
              if (delta < 0 && list)
                rippleOverlayTrack(list, trackId, type, from, from - delta);
              else if (list) {
                for (const item of list) {
                  if (item === object || overlayTrackId(type, item) !== trackId) continue;
                  if (Number(item.start || 0) < from - 0.002) continue;
                  item.start = Number(item.start || 0) + delta;
                  item.end = Number(item.end || 0) + delta;
                  if (Array.isArray(item.words)) {
                    for (const word of item.words) {
                      word.start = Number(word.start || 0) + delta;
                      word.end = Number(word.end || 0) + delta;
                    }
                  }
                }
              }
            }
          }
          if (timelineDrag.trim && timelineDrag.mainTrimClip && !timelineDrag.rollEdit &&
              Number.isFinite(timelineDrag.mainTrimTime)) {
            const clip = timelineDrag.mainTrimClip;
            const audioOnly = timelineDrag.trimType === "audio" && !state.avLinked;
            const speed = Math.max(0.05, Number(state.audio.speed || 1));
            const originStart = Number(timelineDrag.originStart);
            const originEnd = Number(timelineDrag.originEnd);
            const edgeTime = Number(timelineDrag.mainTrimTime);
            const delta = timelineDrag.trimEdge === "start"
              ? (edgeTime - originStart)
              : (edgeTime - originEnd);
            const targetSource = timelineDrag.trimEdge === "start"
              ? Math.max(0, Number(clip.sourceStart || 0) + delta * speed)
              : Math.max(0, Number(clip.sourceEnd || 0) + delta * speed);
            const snapshot = timelineDrag.mainClipsSnapshot ||
              (audioOnly ? baseMainAudioClips() : mainClips());
            const previousAudioClips = audioOnly ? mainAudioClips() : [];
            const committed = commitMainEdgeTrim({
              removals: audioOnly ? state.mainAudioRemovals : state.removals,
              manualCuts: audioOnly ? state.mainAudioManualCuts : state.manualCuts,
              clip,
              edge: timelineDrag.trimEdge,
              targetSource,
              mode: timelineDrag.isRipple ? "ripple" : "trim",
              snapshot,
              globalOffset: audioOnly
                ? Math.max(0, Number(state.mainAudioTimelineOffset || 0))
                : Math.max(0, Number(state.mainTimelineOffset || 0)),
              speed,
            });
            if (audioOnly) {
              state.mainAudioRemovals = committed.removals;
              state.mainAudioManualCuts = committed.manualCuts;
              state.mainAudioClipOffsets = committed.audioOffsets;
              adoptMainAudioMaps(previousAudioClips);
              recomputeContentDuration();
            } else {
              state.removals = committed.removals;
              state.manualCuts = committed.manualCuts;
              normalizeRemovals();
              state.mainVideoClipOffsets = committed.videoOffsets;
              state.mainAudioClipOffsets = committed.audioOffsets;
              adoptClipMaps(snapshot, committed.packed);
              applyOverlayRipple(committed.overlayFrom, committed.overlayDelta);
              recomputeContentDuration();
            }
            renderAll();
          }
          if (timelineDrag.moving?.length &&
              Math.abs(e.clientY - Number(timelineDrag.startY || e.clientY)) > 16) {
            const row = document.elementFromPoint(e.clientX, e.clientY)?.closest?.(".trackrow");
            const targetId = row?.dataset.trackKey || "video";
            const targetKind = trackInfo(targetId).kind;
            const created = new Map();
            for (const moving of timelineDrag.moving) {
              const kind = moving.type === "videolayer"
                ? "video"
                : moving.type === "audioasset"
                  ? "audio"
                  : moving.type;
              if (!["video", "audio", "image", "text", "caption"].includes(kind)) continue;
              let trackId = targetKind === kind && targetId !== kind
                ? targetId
                : created.get(kind);
              if (!trackId) {
                trackId = createDynamicTrack(
                  kind,
                  moving.obj.name || moving.obj.text || `${trackMeta[kind]?.label || "素材"}轨道`,
                  targetId,
                );
                created.set(kind, trackId);
              }
              moving.obj.trackId = trackId;
            }
            cleanupEmptyDynamicTracks();
            renderAll();
          }
          if (timelineDrag.moving?.length) {
            for (const mover of timelineDrag.moving) {
              if (Math.abs(Number(mover.obj?.start || 0) - Number(mover.originStart || 0)) > 0.002)
                applyOverlayTrackOverwrite(mover.type, mover.obj);
            }
          }
          if (timelineDrag.mainTrackMove &&
              Math.abs(e.clientY - Number(timelineDrag.startY || e.clientY)) > 16) {
            const row = document.elementFromPoint(e.clientX, e.clientY)?.closest?.(".trackrow");
            const targetId = row?.dataset.trackKey || timelineDrag.mainTrackType;
            const kind = timelineDrag.mainTrackType;
            let trackId = targetId;
            if (trackInfo(targetId).kind !== kind)
              trackId = createDynamicTrack(
                kind,
                `${state.video?.name || trackMeta[kind]?.label || "素材"}片段`,
                targetId,
              );
            const map = kind === "video" ? state.mainVideoTrackMap : state.mainAudioTrackMap;
            if (trackId === kind) delete map[timelineDrag.mainTrackClip.id];
            else map[timelineDrag.mainTrackClip.id] = trackId;
            if (kind === "video" && state.avLinked) {
              let audioTrack = trackInfo(targetId).kind === "audio" ? targetId : "";
              if (!audioTrack || audioTrack === "audio")
                audioTrack = createDynamicTrack(
                  "audio",
                  `${state.video?.name || "视频"}片段 · 音频`,
                  "audio",
                );
              state.mainAudioTrackMap[timelineDrag.mainTrackClip.id] = audioTrack;
            }
            cleanupEmptyDynamicTracks();
            renderAll();
          }
          if (timelineDrag.mainTrackMove && timelineDrag.horizontalMoved) {
            applyMainTrackOverwrite(
              timelineDrag.mainTrackClip.parentId || timelineDrag.mainTrackClip.id,
              timelineDrag.mainTrackType,
            );
          }
          recomputeContentDuration();
          renderTimeline();
          renderPreviewObjects();
          updateInspector();
          timelineDrag = null;
          queueAutosave();
        }
        if (objectDrag?.pointer === e.pointerId) {
          if (objectDrag.framePending) cancelAnimationFrame(objectDrag.framePending);
          applyObjectDragMove(e.clientX, e.clientY);
          if (objectDrag.needsCaptionReflow) {
            void applyCaptionGrouping(state.captions, state.captionLines).then((captions) => {
              state.captions = captions;
              keepCaptionSelection();
              renderAll();
              queueAutosave();
            });
          }
          updateTransformInspector(objectDrag.obj);
          $("centerGuide").classList.remove("on");
          $("frame").classList.remove("object-dragging");
          objectDrag = null;
          renderPreviewObjects();
          updateInspector();
          queueAutosave();
        }
      });
      $("issueList").onclick = (e) => {
        const i = e.target.closest("[data-issue]");
        if (i) selectIssue(i.dataset.issue);
      };
      $("selectAllCaptions").onclick = () => {
        const checks = [...$("captionInspectorList").querySelectorAll("[data-caption-check]")],
          allChecked = checks.length && checks.every((input) => input.checked);
        checks.forEach((input) => (input.checked = !allChecked));
        $("selectAllCaptions").textContent = allChecked ? "全选" : "取消全选";
      };
      $("replaceCaptionsFromScript").onclick = replaceCaptionsFromManuscript;
      function syncTrailingPunctuationSetting(enabled) {
        if (!state.captionStyle) state.captionStyle = {};
        state.captionStyle.stripTrailingPunctuation = enabled;
        if ($("cleanTrailingPunctuation")) $("cleanTrailingPunctuation").checked = enabled;
        if ($("cleanTrailingPunctuationInspector")) $("cleanTrailingPunctuationInspector").checked = enabled;
        for (const caption of state.captions) {
          if (Array.isArray(caption.words) && caption.words.length) {
            caption.text = joinCaptionWords(caption.words);
          }
        }
        captionInspectorKey = "";
        renderAll();
        renderCaptionInspector(true);
        queueAutosave();
      }
      if ($("cleanTrailingPunctuation")) {
        $("cleanTrailingPunctuation").onchange = () => {
          syncTrailingPunctuationSetting($("cleanTrailingPunctuation").checked);
        };
      }
      if ($("cleanTrailingPunctuationInspector")) {
        $("cleanTrailingPunctuationInspector").onchange = () => {
          syncTrailingPunctuationSetting($("cleanTrailingPunctuationInspector").checked);
        };
      }
      $("captionInspectorList").oninput = (event) => {
        const auxEditor = event.target.closest("[data-caption-aux-edit]");
        if (auxEditor) {
          const caption = state.captions.find((item) => item.id === auxEditor.dataset.captionAuxEdit);
          if (!caption) return;
          caption.auxText = auxEditor.value;
          caption.auxSourceText = caption.text;
          caption.auxLanguage = state.auxSubtitles.language;
          caption.auxLocked = true;
          renderPreviewObjects(true);
          syncAuxSubtitleControls();
          queueAutosave();
          return;
        }
        const editor = event.target.closest("[data-caption-edit]");
        if (!editor) return;
        const caption = state.captions.find((item) => item.id === editor.dataset.captionEdit);
        if (!caption) return;
        caption.text = editor.value;
        caption.words = timedCaptionWords(editor.value, caption);
        const auxStatus = auxiliaryCaptionState(caption);
        const auxLabel = editor.closest("[data-caption-row]")?.querySelector(".caption-aux-state");
        if (auxLabel) {
          auxLabel.className = `caption-aux-state ${auxStatus.key}`;
          auxLabel.textContent = auxStatus.label;
        }
        captionInspectorKey = "";
        renderTimeline();
        renderPreviewObjects();
        syncAuxSubtitleControls();
        queueAutosave();
      };
      $("captionInspectorList").onclick = (event) => {
        const button = event.target.closest("[data-caption-aux-retranslate]");
        if (!button) return;
        event.preventDefault();
        generateAuxiliarySubtitles([button.dataset.captionAuxRetranslate]);
      };
      if ($("generateAuxSubtitles"))
        $("generateAuxSubtitles").onclick = () => generateAuxiliarySubtitles();
      if ($("auxSubtitleLanguage"))
        $("auxSubtitleLanguage").onchange = () => {
          state.auxSubtitles.language = $("auxSubtitleLanguage").value || "zh-Hans";
          captionInspectorKey = "";
          renderCaptionInspector(true);
          syncAuxSubtitleControls();
          queueAutosave();
        };
      if ($("auxSubtitleEditorVisible"))
        $("auxSubtitleEditorVisible").onchange = () => {
          state.auxSubtitles.editorVisible = $("auxSubtitleEditorVisible").checked;
          renderPreviewObjects(true);
          queueAutosave();
        };
      $("visualLayer").onpointerdown = (e) => {
        const o = e.target.closest("[data-type]");
        if (!o) return;
        selectItem(
          o.dataset.type,
          o.dataset.id,
          e.shiftKey || e.metaKey || e.ctrlKey,
          e.metaKey || e.ctrlKey,
        );
        if (!guardUnlocked(o.dataset.type, o.dataset.id)) return;
        const obj = currentObject();
        snapshot();
        objectDrag = {
          pointer: e.pointerId,
          obj,
          startX: e.clientX,
          startY: e.clientY,
          x: obj.x || 0,
          y: obj.y || 0,
        };
        $("frame").classList.add("object-dragging");
        updateSelectionBox();
        e.preventDefault();
      };
      $("captionPreview").onpointerdown = (e) => {
        const caption = captionAtTime(state.currentTime);
        if (!caption) return;
        selectItem("caption", caption.id, false, false);
        if (!guardUnlocked("caption", caption.id)) return;
        snapshot();
        objectDrag = {
          pointer: e.pointerId,
          obj: state.captionTransform,
          startX: e.clientX,
          startY: e.clientY,
          x: state.captionTransform.x || 0,
          y: state.captionTransform.y || 0,
        };
        $("frame").classList.add("object-dragging");
        updateSelectionBox();
        e.preventDefault();
        e.stopPropagation();
      };
      $("reviewPreview").onpointerdown = (e) => {
        const id = e.currentTarget.dataset.id;
        if (id) selectIssue(id);
        e.preventDefault();
      };
      $("selectionBox").onpointerdown = (e) => {
        const handle = e.target.closest("[data-handle]"),
          widthHandle = e.target.closest("[data-width-handle]"),
          rotateHandle = e.target.closest("[data-rotate-handle]");
        if (!handle && !widthHandle && !rotateHandle) return;
        if (!guardUnlocked()) return;
        const object = currentObject();
        if (!object) return;
        const rect = $("selectionBox").getBoundingClientRect();
        const centerX = rect.left + rect.width / 2,
          centerY = rect.top + rect.height / 2,
          textElement = state.selected.type === "caption"
            ? $("captionPreview")
            : $("frame").querySelector(`[data-type="text"][data-id="${state.selected.id}"]`),
          minimumWidth = widthHandle
            ? minimumTwoLineTextWidth(
                textElement,
                ($("frame").clientWidth || 1) / Number(state.width || 1080),
              )
            : 160;
        objectDrag = {
          pointer: e.pointerId,
          obj: object,
          resize: !!handle,
          widthResize: !!widthHandle,
          widthSide: widthHandle?.dataset.widthHandle || "",
          rotate: !!rotateHandle,
          startX: e.clientX,
          startY: e.clientY,
          scale: object.scale || 1,
          width: Number(object.width) || Number(state.width || 1080) * 0.8,
          minimumWidth,
          x: Number(object.x || 0),
          size: Math.max(rect.width, rect.height),
          centerX,
          centerY,
          rotation: Number(object.rotation || 0),
          startAngle: (Math.atan2(e.clientY - centerY, e.clientX - centerX) * 180) / Math.PI,
        };
        $("frame").classList.add("object-dragging");
        e.preventDefault();
        e.stopPropagation();
      };
      $("video").onpointerdown = (e) => {
        const clip = activeMainVideoClip();
        if (!clip) return;
        selectItem("video", clip.id, false, false);
        if (!guardUnlocked("video", clip.id)) return;
        snapshot();
        const transform = mainVideoSettings(clip);
        objectDrag = {
          pointer: e.pointerId,
          obj: transform,
          startX: e.clientX,
          startY: e.clientY,
          x: transform.x || 0,
          y: transform.y || 0,
        };
        $("frame").classList.add("object-dragging");
        updateSelectionBox();
        e.preventDefault();
      };
      function eventInTimelineZoomArea(target) {
        return Boolean(
          target?.closest?.(
            "#timeline, #timelineScroll, #timelineMain, #trackLabels, #rulerBar, #rulerTimecode, #timelineZoom",
          ),
        );
      }
      function preventBrowserPageZoom(event) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      let wheelZoomTarget = 60;
      let wheelZoomFrame = 0;
      let wheelZoomAnchorX = 0;
      function scheduleFluidTimelineZoom(deltaPixels, clientX) {
        wheelZoomTarget = clamp(wheelZoomTarget * Math.exp(-clamp(deltaPixels, -120, 120) * 0.0024), 1, 300);
        wheelZoomAnchorX = clientX;
        if (wheelZoomFrame) return;
        wheelZoomFrame = requestAnimationFrame(() => {
          wheelZoomFrame = 0;
          const distance = wheelZoomTarget - Number(state.zoom || 60);
          const next = Math.abs(distance) < 0.08 ? wheelZoomTarget : Number(state.zoom || 60) + distance * 0.72;
          setTimelineZoomAroundPlayhead(next, wheelZoomAnchorX);
          if (Math.abs(wheelZoomTarget - next) >= 0.08) scheduleFluidTimelineZoom(0, wheelZoomAnchorX);
        });
      }
      window.addEventListener(
        "wheel",
        (e) => {
          const inTimeline = eventInTimelineZoomArea(e.target);
          if (!inTimeline) return;
          const deltaPixels = e.deltaMode === 1 ? Number(e.deltaY || 0) * 16 : e.deltaMode === 2 ? Number(e.deltaY || 0) * 120 : Number(e.deltaY || 0);
          if ((e.ctrlKey || e.metaKey) && inTimeline) {
            preventBrowserPageZoom(e);
            if (!wheelZoomFrame && Math.abs(wheelZoomTarget - Number(state.zoom || 60)) > 0.2) wheelZoomTarget = Number(state.zoom || 60);
            wheelZoomTarget = Number.isFinite(wheelZoomTarget) ? wheelZoomTarget : Number(state.zoom || 60);
            scheduleFluidTimelineZoom(deltaPixels, e.clientX);
            return;
          }
          if (e.altKey && inTimeline) {
            preventBrowserPageZoom(e);
            if (!wheelZoomFrame && Math.abs(wheelZoomTarget - Number(state.zoom || 60)) > 0.2) wheelZoomTarget = Number(state.zoom || 60);
            wheelZoomTarget = Number.isFinite(wheelZoomTarget) ? wheelZoomTarget : Number(state.zoom || 60);
            scheduleFluidTimelineZoom(deltaPixels, e.clientX);
            return;
          }
          if (e.shiftKey && $("timelineScroll")) {
            e.preventDefault();
            $("timelineScroll").scrollLeft += Number(e.deltaY || e.deltaX || 0);
          }
        },
        { passive: false, capture: true },
      );
      for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
        window.addEventListener(type, preventBrowserPageZoom, { passive: false, capture: true });
      }
      $("timelineScroll").addEventListener("scroll", () => {
        $("trackLabels").scrollTop = $("timelineScroll").scrollTop;
        syncTimelineChrome();
        scheduleWaveformRender();
      });
      if ($("timelineMain")) {
        $("timelineMain").addEventListener("pointerleave", () => {
          if (!timelineDrag) setBladeGuide(0, false);
        });
      }
      $("stage").addEventListener(
        "wheel",
        (event) => {
          event.preventDefault();
          const rawDelta = Number(event.deltaY || 0);
          const deltaPixels = event.deltaMode === 1 ? rawDelta * 16 : (event.deltaMode === 2 ? rawDelta * 120 : rawDelta);
          const delta = clamp(deltaPixels, -12, 12);
          const factor = Math.exp(-delta * 0.00045);
          state.canvasZoom = clamp(Number(state.canvasZoom || 1) * factor, 0.25, 4);
          $("frame").style.transform = `scale(${state.canvasZoom})`;
          $("canvasZoomLabel").textContent = `${Math.round(state.canvasZoom * 100)}%`;
          updateSelectionBox();
        },
        { passive: false },
      );
      $("objectScale").oninput = (e) => {
        const targets = mutateSelectedVisualTransforms(
          (object) => { object.scale = Number(e.target.value) / 100; },
        );
        if (!targets.length) return;
        $("scaleOut").textContent = `${e.target.value}%`;
        updatePreviewTransformOnly();
      };
      $("objectX").oninput = (e) => {
        const targets = mutateSelectedVisualTransforms(
          (object) => { object.x = Number(e.target.value); },
        );
        if (targets.length) {
          updatePreviewTransformOnly();
        }
      };
      $("objectY").oninput = (e) => {
        const targets = mutateSelectedVisualTransforms(
          (object) => { object.y = Number(e.target.value); },
        );
        if (targets.length) {
          updatePreviewTransformOnly();
        }
      };
      $("objectRotation").oninput = (e) => {
        const targets = mutateSelectedVisualTransforms(
          (object) => { object.rotation = Number(e.target.value); },
        );
        if (!targets.length) return;
        $("rotationOut").textContent = `${e.target.value}°`;
        updatePreviewTransformOnly();
      };
      $("objectOpacity").oninput = (e) => {
        const targets = mutateSelectedVisualTransforms(
          (object) => { object.opacity = Number(e.target.value) / 100; },
        );
        if (!targets.length) return;
        $("opacityOut").textContent = `${e.target.value}%`;
        updatePreviewTransformOnly();
      };
      $("objectBlendMode").onchange = (e) => {
        const targets = mutateSelectedVisualTransforms(
          (object) => { object.blendMode = e.target.value; },
        );
        if (!targets.length) return;
        renderPreviewObjects();
        queueAutosave();
      };
      for (const [id, key] of [
        ["cropTop", "cropTop"],
        ["cropBottom", "cropBottom"],
        ["cropLeft", "cropLeft"],
        ["cropRight", "cropRight"],
      ]) {
        if ($(id)) {
          $(id).oninput = (e) => {
            const value = Math.max(0, Math.min(95, Number(e.target.value) || 0));
            const targets = mutateSelectedVisualTransforms(
              (object) => { object[key] = value; },
            );
            if (!targets.length) return;
            $(`${id}Out`).textContent = `${value}%`;
            renderPreviewObjects();
            queueAutosave();
          };
        }
      }
      if ($("resetCropBtn")) {
        $("resetCropBtn").onclick = () => {
          if (!guardUnlocked()) return;
          snapshot();
          const targets = mutateSelectedVisualTransforms((object) => {
            object.cropTop = 0;
            object.cropBottom = 0;
            object.cropLeft = 0;
            object.cropRight = 0;
          });
          if (!targets.length) return;
          if ($("cropTop")) {
            $("cropTop").value = 0;
            $("cropTopOut").textContent = "0%";
            $("cropBottom").value = 0;
            $("cropBottomOut").textContent = "0%";
            $("cropLeft").value = 0;
            $("cropLeftOut").textContent = "0%";
            $("cropRight").value = 0;
            $("cropRightOut").textContent = "0%";
          }
          renderPreviewObjects();
          queueAutosave();
        };
      }
      $("centerObject").onclick = () => {
        if (guardUnlocked()) {
          snapshot();
          const targets = mutateSelectedVisualTransforms((object) => {
            object.x = 0;
            object.y = 0;
          });
          if (!targets.length) return;
          renderAll();
        }
      };
      $("fitObject").onclick = () => {
        if (guardUnlocked()) {
          snapshot();
          const targets = mutateSelectedVisualTransforms((object) => {
            object.scale = 1;
            object.x = 0;
            object.y = 0;
          });
          if (!targets.length) return;
          renderAll();
        }
      };
      for (const id of [
        "objectScale", "objectX", "objectY", "objectRotation", "objectOpacity",
        "objectBlendMode", "cropTop", "cropBottom", "cropLeft", "cropRight",
      ]) {
        const control = $(id);
        if (!control) continue;
        control.addEventListener("pointerdown", () => {
          if (guardUnlocked()) snapshot();
        });
        control.addEventListener("keydown", (event) => {
          if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key) && guardUnlocked())
            snapshot();
        });
      }
      function refreshLiveTextStyle(reflow = true) {
        const style = currentStyle() || state.captionStyle;
        if (!style) return;
        if (state.selected.type === "caption" || state.captions.length) {
          const caption = captionAtTime(state.currentTime) ||
            state.captions.find((item) => item.id === state.selected.id) ||
            state.captions[0];
          const preview = $("captionPreview");
          if (preview) {
            if (caption && reflow) renderCaptionWords(preview, caption);
            if (caption) updateCaptionWordStates(preview);
            preview.style.setProperty("--active", state.captionStyle.highlight || "#ffd21f");
            preview.classList.toggle("no-highlight", state.captionStyle.highlightEnabled === false);
            const px = ($("frame").clientWidth || 1) / Math.max(1, state.width);
            applyCaptionCanvasHost(preview, px);
          }
        }
        if (state.selected.type === "text") {
          const obj = currentObject();
          const el = $("frame").querySelector(`[data-type="text"][data-id="${state.selected.id}"]`);
          if (el && obj) {
            const px = ($("frame").clientWidth || 1) / Math.max(1, state.width);
            applyTextStyle(el, obj.style || state.captionStyle, px);
            applyTextBoxWidth(el, obj.width, px);
          }
        }
        updateSelectionBox();
        queueAutosave();
      }

      for (const id of [
        "fontSize",
        "fontWeight",
        "letterSpacing",
        "wordSpacing",
        "lineHeight",
        "fontColor",
        "highlightColor",
        "highlightEnabled",
        "strokeColor",
        "stroke",
        "shadowColor",
        "shadowStrength",
        "shadowOpacity",
        "shadowBlur",
        "shadowDistance",
        "shadowAngle",
        "glowColor",
        "glow",
        "backgroundEnabled",
        "backgroundFitText",
        "backgroundColor",
        "backgroundOpacity",
        "backgroundWidth",
        "backgroundHeight",
        "backgroundX",
        "backgroundY",
        "backgroundRadius",
      ]) {
        const syncAndRefresh = () => {
          const s = currentStyle() || state.captionStyle;
          if (!s) return;
          s.fontSize = Number($("fontSize").value);
          s.fontWeight = Number($("fontWeight").value);
          s.letterSpacing = Number($("letterSpacing").value);
          s.wordSpacing = Number($("wordSpacing").value);
          s.lineHeight = Number($("lineHeight").value) / 100;
          $("letterSpacingOut").textContent = `${s.letterSpacing}px`;
          $("wordSpacingOut").textContent = `${s.wordSpacing}px`;
          $("lineHeightOut").textContent = `${Math.round(s.lineHeight * 100)}%`;
          s.color = $("fontColor").value;
          s.highlight = $("highlightColor").value;
          s.highlightColor = $("highlightColor").value;
          s.highlightEnabled = $("highlightEnabled").checked;
          s.strokeColor = $("strokeColor").value;
          s.stroke = Number($("stroke").value);
          s.shadowColor = $("shadowColor").value;
          s.shadow = Number($("shadowStrength").value);
          s.shadowOpacity = Number($("shadowOpacity").value) / 100;
          s.shadowBlur = Number($("shadowBlur").value);
          s.shadowDistance = Number($("shadowDistance").value);
          s.shadowAngle = ((Number($("shadowAngle").value) % 360) + 360) % 360;
          $("shadowStrengthOut").textContent = s.shadow.toFixed(1);
          $("shadowOpacityOut").textContent = `${Math.round(s.shadowOpacity * 100)}%`;
          $("shadowBlurOut").textContent = s.shadowBlur;
          $("shadowDistanceOut").textContent = s.shadowDistance;
          $("shadowAngleOut").textContent = `${s.shadowAngle}°`;
          s.glowColor = $("glowColor").value;
          s.glow = Number($("glow").value);
          $("glowOut").textContent = s.glow;
          s.backgroundEnabled = $("backgroundEnabled").checked;
          if ($("backgroundFitText")) s.backgroundFitText = $("backgroundFitText").checked;
          s.background = $("backgroundColor").value;
          s.backgroundColor = $("backgroundColor").value;
          s.backgroundOpacity = Number($("backgroundOpacity").value) / 100;
          $("backgroundOpacityOut").textContent = `${Math.round(s.backgroundOpacity * 100)}%`;
          s.backgroundWidth = Number($("backgroundWidth").value);
          s.backgroundHeight = Number($("backgroundHeight").value);
          s.backgroundX = Number($("backgroundX").value);
          s.backgroundY = Number($("backgroundY").value);
          s.padding = Math.max(s.backgroundWidth, s.backgroundHeight);
          s.radius = Number($("backgroundRadius").value);
          s.backgroundRadius = Number($("backgroundRadius").value);
          $("backgroundWidthOut").textContent = s.backgroundWidth;
          $("backgroundHeightOut").textContent = s.backgroundHeight;
          $("backgroundXOut").textContent = s.backgroundX;
          $("backgroundYOut").textContent = s.backgroundY;
          $("backgroundRadiusOut").textContent = s.radius;
          refreshLiveTextStyle(true);
        };
        const el = $(id);
        if (el) {
          el.oninput = () => {
            syncAndRefresh();
            if (["fontSize", "fontWeight", "letterSpacing", "wordSpacing", "stroke", "backgroundWidth", "backgroundEnabled", "backgroundFitText"].includes(id))
              scheduleCaptionReflow();
          };
          el.onchange = () => {
            syncAndRefresh();
            if (["fontSize", "fontWeight", "letterSpacing", "wordSpacing", "stroke", "backgroundWidth", "backgroundEnabled", "backgroundFitText"].includes(id))
              scheduleCaptionReflow();
          };
        }
      }
      document.querySelectorAll("[data-text-align]").forEach((button) => {
        button.onclick = () => {
          const style = currentStyle();
          if (!style) return;
          style.textAlign = button.dataset.textAlign;
          renderAll();
        };
      });
      function syncCaptionLineButtons() {
        const mode = normalizeCaptionLineMode(state.captionLines);
        document.querySelectorAll("[data-caption-lines]").forEach((button) =>
          button.classList.toggle("active", normalizeCaptionLineMode(button.dataset.captionLines) === mode),
        );
      }
      let captionReflowTimer = 0;
      function scheduleCaptionReflow() {
        window.clearTimeout(captionReflowTimer);
        captionReflowTimer = window.setTimeout(() => {
          if (!(state.captions || []).length) return;
          void applyCaptionGrouping(state.captions, state.captionLines).then((captions) => {
            state.captions = captions;
            keepCaptionSelection();
            renderAll();
            queueAutosave();
          });
        }, 80);
      }
      function captionLayoutPayload(mode) {
        return {
          captionLines: normalizeCaptionLineMode(mode ?? state.captionLines),
          boxWidth: state.captionTransform?.width,
          canvasWidth: state.width,
          scale: state.captionTransform?.scale || 1,
          style: state.captionStyle,
        };
      }
      function keepCaptionSelection() {
        if (state.selected?.type !== "caption") return;
        if (!state.captions.length) return;
        if (state.captions.some((item) => item.id === state.selected.id)) return;
        const current = captionAtTime(state.currentTime) || state.captions[0];
        state.selected = { type: "caption", id: current.id };
        state.selectedItems = [{ type: "caption", id: current.id }];
      }
      async function applyCaptionGrouping(captions, mode) {
        if (!(captions || []).length) return captions || [];
        try {
          return await nativeCall("regroupCaptions", {
            captions,
            ...captionLayoutPayload(mode),
          });
        } catch {
          return captions;
        }
      }
      async function setCaptionLineMode(mode) {
        const next = normalizeCaptionLineMode(mode);
        if (next === normalizeCaptionLineMode(state.captionLines) && document.querySelector("[data-caption-lines].active")) {
          syncCaptionLineButtons();
          return;
        }
        snapshot();
        state.captionLines = next;
        if ((state.captions || []).length) {
          state.captions = await applyCaptionGrouping(state.captions, next);
          keepCaptionSelection();
        }
        syncCaptionLineButtons();
        renderAll();
        queueAutosave();
      }
      document.querySelectorAll("[data-caption-lines]").forEach((button) => {
        button.onclick = () => {
          void setCaptionLineMode(button.dataset.captionLines);
        };
      });
      $("fontBoldToggle").onclick = () => {
        const style = currentStyle();
        if (!style) return;
        style.fontWeight = Number(style.fontWeight || 700) >= 700 ? 500 : 800;
        renderAll();
      };
      $("fontItalicToggle").onclick = () => {
        const style = currentStyle();
        if (!style) return;
        style.fontItalic = !style.fontItalic;
        renderAll();
      };
      $("fontUnderlineToggle").onclick = () => {
        const style = currentStyle();
        if (!style) return;
        style.fontUnderline = !style.fontUnderline;
        renderAll();
      };
      document.querySelectorAll("[data-text-case]").forEach((button) => {
        button.onclick = () => {
          const style = currentStyle();
          if (!style) return;
          style.textCase = style.textCase === button.dataset.textCase
            ? "none"
            : button.dataset.textCase;
          renderAll();
        };
      });
      document.querySelectorAll("[data-vertical-align]").forEach((button) => {
        button.onclick = () => {
          const style = currentStyle();
          if (!style) return;
          style.verticalAlign = button.dataset.verticalAlign;
          renderAll();
        };
      });
      document.querySelectorAll("[data-background-mode]").forEach((button) => {
        button.onclick = () => {
          const style = currentStyle();
          if (!style) return;
          style.backgroundMode = button.dataset.backgroundMode;
          style.backgroundEnabled = true;
          renderAll();
        };
      });
      document.querySelectorAll("[data-animation-mode]").forEach((button) => {
        button.onclick = () => {
          animationMode = button.dataset.animationMode;
          renderAnimationPanel();
        };
      });
      $("animationGrid").onclick = (event) => {
        const card = event.target.closest("[data-animation-id]"),
          object = selectedAnimationObject();
        if (!card) return;
        if (!object) {
          toast("请先点击“添加文本”，或选中时间线上的文字/图片");
          return;
        }
        snapshot();
        object[`${animationMode}Animation`] = card.dataset.animationId;
        object[`${animationMode}Duration`] ||= 0.45;
        renderPreviewObjects(false);
        renderAnimationPanel();
        queueAutosave();
        toast(`已套用${animationMode === "enter" ? "入场" : "出场"}动画`);
      };
      $("animationGrid").onpointerover = (event) => {
        const card = event.target.closest("[data-animation-id]");
        if (!card || card.contains(event.relatedTarget)) return;
        card.classList.remove("previewing");
        void card.offsetWidth;
        card.classList.add("previewing");
      };
      $("animationDuration").oninput = (event) => {
        const object = selectedAnimationObject();
        if (!object) return;
        object[`${animationMode}Duration`] = Number(event.target.value) / 100;
        $("animationDurationOut").textContent = `${object[`${animationMode}Duration`].toFixed(2)}秒`;
        renderPreviewObjects(false);
      };
      $("animationDuration").onchange = () => queueAutosave();
      $("inspect-animation").querySelector("[data-animation-clear]").onclick = () => {
        const object = selectedAnimationObject();
        if (!object) return;
        snapshot();
        object[`${animationMode}Animation`] = "";
        renderAll();
      };
      $("objectText").oninput = (e) => {
        const o =
          state.selected.type === "caption"
            ? currentTimelineObject()
            : currentObject();
        if (o && "text" in o) {
          o.text = e.target.value;
          renderPreviewObjects();
          renderTimeline();
        }
      };
      $("presetList").onclick = (e) => {
        const delBtn = e.target.closest("[data-del-preset]");
        if (delBtn) {
          e.stopPropagation();
          const customIdx = Number(delBtn.dataset.delPreset);
          const target = customPresets[customIdx];
          if (target && confirm(`确定要删除自定义模板「${target.name}」吗？`)) {
            customPresets.splice(customIdx, 1);
            try {
              localStorage.setItem("quickcut_custom_caption_presets", JSON.stringify(customPresets));
            } catch (err) {}
            renderPresets();
            toast("已删除自定义模板");
          }
          return;
        }
        const b = e.target.closest("[data-preset]");
        if (!b) return;
        const preset = allCaptionPresets()[Number(b.dataset.preset)];
        if (!preset) return;
        snapshot();
        // Each preset is a complete state replacement, never a delta layered on the previous style.
        state.captionStyle = normalizedCaptionStyle(preset.style);
        state.captionStyle.backgroundWidth = Number(preset.style?.backgroundWidth ?? state.captionStyle.padding ?? 14);
        state.captionStyle.backgroundHeight = Number(preset.style?.backgroundHeight ?? state.captionStyle.padding ?? 14);
        state.captionStyle.radius = Number(preset.style?.radius ?? 20);
        previewSceneKey = "";
        renderAll();
        updateInspector();
        toast(`已套用「${preset.name}」样式`);
      };
      $("presetList").onpointerover = (event) => {
        const card = event.target.closest("[data-preset]");
        if (!card || card.contains(event.relatedTarget)) return;
        const preview = card.querySelector(".captionobject");
        if (!preview) return;
        preview.classList.remove("anim-enter");
        preview.querySelectorAll(".word").forEach((word) =>
          word.classList.remove("past", "active"),
        );
        void preview.offsetWidth;
        preview.classList.add("anim-enter");
        const words = preview.querySelectorAll(".word");
        words[0]?.classList.add("past");
        words[1]?.classList.add("active");
      };
      $("saveCaptionPreset").onclick = () => {
        $("captionPresetName").value = `我的样式 ${customPresets.length + 1}`;
        $("captionPresetModal").classList.add("on");
        $("captionPresetName").focus();
        $("captionPresetName").select();
      };
      $("captionPresetCancel").onclick = () =>
        $("captionPresetModal").classList.remove("on");
      $("captionPresetConfirm").onclick = async () => {
        const name = $("captionPresetName").value.trim();
        if (!name) return;
        const currentCapStyle = state.captionStyle || currentStyle() || {};
        const newPreset = {
          id: `custom_${Date.now()}`,
          name,
          isCustom: true,
          style: JSON.parse(JSON.stringify(currentCapStyle)),
        };
        customPresets.unshift(newPreset);
        try {
          localStorage.setItem("quickcut_custom_caption_presets", JSON.stringify(customPresets));
        } catch (e) {}
        try {
          await nativeCall("saveCaptionPreset", {
            name,
            style: { ...currentCapStyle },
          });
        } catch (error) {}
        renderPresets();
        $("captionPresetModal").classList.remove("on");
        toast(`自定义模板「${name}」已保存！`);
      };
      const registeredFontPaths = new Set();
      let availableLocalFonts = [];
      let localFontCatalogLoaded = false;
      