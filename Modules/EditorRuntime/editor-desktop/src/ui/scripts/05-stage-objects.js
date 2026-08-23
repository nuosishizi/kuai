function placeLibraryAsset(
        id,
        target = "timeline",
        at = state.currentTime,
        trackId = "",
      ) {
        let asset = state.libraryAssets.find((item) => item.id === id);
        if (!asset) return;
        if (asset.missing) {
          await relinkLibraryAsset(asset);
          asset = state.libraryAssets.find((item) => item.id === id);
          if (!asset || asset.missing) return;
        }
        if (
          ["video", "audio"].includes(asset.kind) &&
          !asset.analysisJobId &&
          (!Array.isArray(asset.waveform) || !asset.waveform.length)
        ) {
          const refreshed = await nativeCall(
            asset.kind === "video" ? "addVideoPath" : "addAudioPath",
            { projectId: state.projectId, path: asset.path },
          );
          Object.assign(asset, refreshed || {});
          watchMediaAnalysis(asset);
        }
        if (asset.kind === "video")
          return importVideo(
            asset,
            target === "media" ? "media" : "timeline",
            at,
            trackId,
          );
        if (asset.kind === "image") return importImage(asset, target, at, trackId);
        if (asset.kind === "audio") return importAudio(asset, target, at, trackId);
        if (asset.kind === "subtitle")
          return importSubtitle(asset, target, at, trackId);
      }
      function addText() {
        snapshot();
        const item = {
          id: uid(),
          trackId: createDynamicTrack("text", "", "video"),
          text: "输入标题文字",
          start: state.currentTime,
          end: state.currentTime + 3,
          x: 0,
          y: -120,
          width: Math.round(Number(state.width || 1080) * 0.72),
          scale: 1,
          rotation: 0,
          opacity: 1,
          blendMode: "normal",
          enterAnimation: "",
          exitAnimation: "",
          enterDuration: 0.45,
          exitDuration: 0.45,
          style: {
            ...state.captionStyle,
            backgroundEnabled: true,
            backgroundOpacity: 0.55,
            fontSize: 64,
          },
        };
        state.titles.push(item);
        recomputeContentDuration();
        state.selected = { type: "text", id: item.id };
        state.selectedItems = [{ type: "text", id: item.id }];
        renderAll();
      }
      function ensureLibraryAssets() {
        const add = (item, kind) => {
          if (
            item?.path &&
            !(state.hiddenLibraryPaths || []).includes(item.path) &&
            !state.libraryAssets.some((asset) => asset.path === item.path)
          )
            state.libraryAssets.push({ id: uid(), kind, ...item });
        };
        add(state.video, "video");
        state.images.forEach((item) => add(item, "image"));
        state.audioAssets.forEach((item) => add(item, "audio"));
      }
      function mediaPreviewMarkup(asset) {
        const previewUrl =
            asset.previewUrl || (asset.kind === "image" ? asset.url : ""),
          icon =
            asset.kind === "video"
              ? "▶"
              : asset.kind === "audio"
                ? "♪"
                : asset.kind === "image"
                  ? "◆"
                  : "CC";
        return `<div class="thumb media-preview"><span class="thumb-fallback">${icon}</span>${previewUrl ? `<img src="${escapeHtml(previewUrl)}" alt="${escapeHtml(asset.name || "素材预览")}" onerror="this.remove()">` : ""}</div>`;
      }
      let libraryMediaRenderKey = "";
      function mediaList() {
        ensureLibraryAssets();
        const renderKey = JSON.stringify(
          state.libraryAssets.map((asset) => [
            asset.id,
            asset.name,
            asset.kind,
            asset.previewUrl,
            asset.duration,
            asset.width,
            asset.height,
            asset.missing,
          ]),
        );
        if (renderKey === libraryMediaRenderKey) return;
        libraryMediaRenderKey = renderKey;
        const label = {
            video: "视频",
            image: "图片",
            audio: "音频",
            subtitle: "字幕",
          },
          list = state.libraryAssets.map((asset) => {
            const preview = mediaPreviewMarkup(asset);
            const detail =
              asset.kind === "video"
                ? `${asset.width || 0}×${asset.height || 0} · ${formatTime(asset.duration, false)}`
                : asset.kind === "audio"
                  ? formatTime(asset.duration, false)
                  : `${label[asset.kind] || "素材"}文件`;
            return `<div class="mediaitem ${asset.missing ? "missing" : ""}" draggable="${asset.missing ? "false" : "true"}" data-library-id="${escapeHtml(asset.id)}" title="${escapeHtml(asset.name)}">${preview}<div><b class="ellipsis">${escapeHtml(asset.name)}</b><div class="small ellipsis ${asset.missing ? "missing-label" : ""}">${asset.missing ? "素材已移动或删除 · 右键重新关联" : escapeHtml(detail)}</div><div class="media-kind">${escapeHtml(label[asset.kind] || asset.kind)}</div></div><button class="media-delete" data-delete-library="${escapeHtml(asset.id)}" title="从素材库移除">×</button></div>`;
          });
        $("mediaList").innerHTML =
          list.join("") ||
          '<div class="small" style="margin-top:10px">还没有素材。可以拖入文件，或使用顶部导入按钮。</div>';
        $("mediaList")
          .querySelectorAll("[data-library-id]")
          .forEach((card) => {
            card.ondragstart = (event) => {
              event.dataTransfer.effectAllowed = "copy";
              event.dataTransfer.setData(
                "application/x-quickcut-asset",
                card.dataset.libraryId,
              );
            };
            card.onclick = async (event) => {
              if (event.target.closest("[data-delete-library]") || card.dataset.busy === "1")
                return;
              card.dataset.busy = "1";
              card.classList.add("busy");
              try {
                await placeLibraryAsset(
                  card.dataset.libraryId,
                  "timeline",
                  state.currentTime,
                );
              } finally {
                card.dataset.busy = "0";
                card.classList.remove("busy");
              }
            };
            card.oncontextmenu = (event) => {
              const asset = state.libraryAssets.find((item) => item.id === card.dataset.libraryId);
              if (!asset) return;
              showContextMenu(event, [
                { label: asset.missing ? "重新关联素材…" : "加入时间线", action: () => asset.missing ? relinkLibraryAsset(asset) : placeLibraryAsset(asset.id) },
                { label: "重新关联素材…", action: () => relinkLibraryAsset(asset) },
                !asset.missing && { label: "在访达中显示", action: () => nativeCall("revealFile", asset.path) },
                { label: "从素材库移除", danger: true, action: () => removeLibraryAsset(asset.id) },
              ]);
            };
          });
        $("mediaList").querySelectorAll("[data-delete-library]").forEach((button) => {
          button.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            removeLibraryAsset(button.dataset.deleteLibrary);
          };
          button.onpointerdown = (event) => event.stopPropagation();
        });
      }
      let previewSceneKey = "";
      function normalizedTransform(value, fallback) {
        return {
          x: Number(value?.x ?? fallback.x) || 0,
          y: Number(value?.y ?? fallback.y) || 0,
          scale: clamp(Number(value?.scale ?? fallback.scale) || 1, 0.05, 8),
          ...(value?.width != null || fallback.width != null
            ? { width: clamp(Number(value?.width ?? fallback.width) || 860, 160, 4000) }
            : {}),
        };
      }
      function ensureIndependentTransforms() {
        if (state.videoTransform === state.captionTransform)
          state.captionTransform = { ...(state.captionTransform || {}) };
        const video = normalizedTransform(state.videoTransform, {
          x: 0,
          y: 0,
          scale: 1,
        });
        const caption = normalizedTransform(state.captionTransform, {
          x: 0,
          y: Math.round(Number(state.height || 1920) * 0.28),
          scale: 1,
          width: Math.round(Number(state.width || 1080) * 0.8),
        });
        Object.assign(state.videoTransform || (state.videoTransform = {}), video);
        Object.assign(
          state.captionTransform || (state.captionTransform = {}),
          caption,
        );
      }
      function syncLayerVideoElement(element, item) {
        if (!element) return;
        const local = Math.max(
          0,
          Number(item.sourceStart || 0) +
            (state.currentTime - item.start) * Number(state.audio.speed || 1),
        );
        if (element.readyState > 0 && Math.abs(element.currentTime - local) > 0.16)
          element.currentTime = local;
        applyMediaPlaybackRate(element, Number(state.audio.speed || 1));
        if (state.playing) element.play().catch(() => {});
        else element.pause();
      }
      function updateCaptionWordStates(element) {
        if (!element) return;
        if (element.querySelector("canvas.caption-paint")) {
          paintCaptionPreview(element, captionPaintState.caption || captionAtTime(state.currentTime), {
            relayout: false,
          });
          return;
        }
        for (const word of element.querySelectorAll(".word[data-start]")) {
          const start = Number(word.dataset.start || 0),
            end = Number(word.dataset.end || start);
          word.classList.toggle("past", state.currentTime >= end);
          word.classList.toggle(
            "active",
            state.currentTime >= start && state.currentTime < end,
          );
        }
        if (element.dataset.animation === "line-pulse") {
          const lines = [...element.querySelectorAll(".caption-line")];
          let activeLine = lines.find((line) => line.querySelector(".word.active"));
          if (!activeLine)
            activeLine = lines.find((line) => {
              const words = [...line.querySelectorAll(".word[data-start]")];
              return words.length && state.currentTime <= Number(words.at(-1).dataset.end || 0);
            }) || lines.at(-1);
          lines.forEach((line) => line.classList.toggle("active-line", line === activeLine));
        }
      }
      function reviewTransform(px, py) {
        const gap = Math.max(86, Number(state.captionStyle.fontSize || 54) * 1.55);
        return `translate(calc(-50% + ${state.captionTransform.x * px}px),calc(-50% + ${(state.captionTransform.y - gap) * py}px)) scale(${state.captionTransform.scale || 1})`;
      }
      function updatePreviewTransformOnly(updateBox = true) {
        ensureIndependentTransforms();
        const frame = $("frame"),
          fw = frame.clientWidth || 1,
          fh = frame.clientHeight || 1,
          px = fw / state.width,
          py = fh / state.height;
        const activeMain = activeMainVideoClip(),
          videoTransform = activeMain ? mainVideoSettings(activeMain) : defaultVisualTransform(state.videoTransform);
        $("video").style.transform = `translate(${videoTransform.x * px}px,${videoTransform.y * py}px) rotate(${videoTransform.rotation || 0}deg) scale(${videoTransform.scale})`;
        $("video").style.opacity = videoTransform.opacity ?? 1;
        $("video").style.mixBlendMode = videoTransform.blendMode || "normal";
        const beautyCanvas = $("beautyPreviewCanvas");
        beautyCanvas.style.transform = $("video").style.transform;
        beautyCanvas.style.opacity = $("video").style.opacity;
        beautyCanvas.style.mixBlendMode = $("video").style.mixBlendMode;
        $("captionPreview").style.transform = `translate(calc(-50% + ${state.captionTransform.x * px}px),calc(-50% + ${state.captionTransform.y * py}px)) scale(${state.captionTransform.scale || 1})`;
        renderAuxCaptionPreview(captionAtTime(state.currentTime), px, py);
        $("reviewPreview").style.transform = reviewTransform(px, py);
        const object = currentObject();
        if (object && !["video", "caption", "review", "audio"].includes(state.selected.type)) {
          const element = frame.querySelector(
            `[data-type="${state.selected.type}"][data-id="${state.selected.id}"]`,
          );
          if (element)
            applyAnimatedObjectStyle(
              element,
              object,
              `translate(calc(-50% + ${Number(object.x || 0) * px}px),calc(-50% + ${Number(object.y || 0) * py}px)) rotate(${Number(object.rotation || 0)}deg) scale(${object.scale || 1})`,
            );
        }
        if (updateBox) updateSelectionBox();
      }
      function animationDefinition(item, type, mode) {
        const id = item?.[`${mode}Animation`] || "";
        const list = type === "text" ? textAnimations : imageAnimations;
        return list.find((entry) => entry.id === id) || null;
      }
      function animationVisualState(item, type) {
        const start = Number(item?.start || 0),
          end = Math.max(start + 0.04, Number(item?.end || start + 0.04)),
          enterDuration = Math.min(
            end - start,
            Math.max(0.15, Number(item?.enterDuration || 0.45)),
          ),
          exitDuration = Math.min(
            end - start,
            Math.max(0.15, Number(item?.exitDuration || 0.45)),
          );
        let definition = null,
          intensity = 0,
          mode = "enter";
        if (state.currentTime < start + enterDuration) {
          definition = animationDefinition(item, type, "enter");
          const progress = clamp((state.currentTime - start) / enterDuration, 0, 1);
          intensity = 1 - (1 - Math.pow(1 - progress, 3));
          intensity = 1 - progress * progress * (3 - 2 * progress);
        } else if (state.currentTime > end - exitDuration) {
          mode = "exit";
          definition = animationDefinition(item, type, "exit");
          const progress = clamp((state.currentTime - (end - exitDuration)) / exitDuration, 0, 1);
          intensity = progress * progress * (3 - 2 * progress);
        }
        if (!definition) return { suffix: "", opacity: Number(item?.opacity ?? 1), filter: "", clipPath: "" };
        const sign = mode === "exit" ? 1 : 1,
          distance = type === "image" ? 210 : 105,
          motion = definition.motion,
          id = definition.id;
        let x = 0,
          y = 0,
          scale = 1,
          rotate = 0,
          clipPath = "",
          filter = "";
        if (motion === "left") x = -distance * intensity * sign;
        if (motion === "right") x = distance * intensity * sign;
        if (motion === "up") y = distance * 0.62 * intensity * sign;
        if (motion === "down") y = -distance * 0.62 * intensity * sign;
        if (motion === "zoom") scale = 1 - 0.45 * intensity;
        if (motion === "zoomout") scale = 1 + 0.5 * intensity;
        if (motion === "rotate") {
          rotate = (id.includes("right") ? 14 : -14) * intensity;
          scale = 1 - 0.14 * intensity;
        }
        if (motion === "flip") {
          scale = Math.max(0.08, 1 - 0.9 * intensity);
          rotate = (id.endsWith("y") ? 8 : -8) * intensity;
        }
        if (motion === "blur") filter = `blur(${(8 * intensity).toFixed(2)}px)`;
        if (/light|flare|halo|sparkle|electric|rays|star|particle|comet|dust/.test(id))
          filter = `brightness(${(1 + .9 * (1 - intensity)).toFixed(2)}) drop-shadow(0 0 ${(4 + 15 * (1 - intensity)).toFixed(1)}px rgba(120,210,255,.9))`;
        if (id.includes("wipe") || id === "typewriter" || id.includes("reveal")) {
          const amount = Math.round(intensity * 100);
          clipPath = id.includes("right")
            ? `inset(0 ${amount}% 0 0)`
            : id.includes("up")
              ? `inset(0 0 ${amount}% 0)`
              : id.includes("down")
                ? `inset(${amount}% 0 0 0)`
                : `inset(0 0 0 ${amount}%)`;
        }
        return {
          suffix: ` translate(${x.toFixed(2)}px,${y.toFixed(2)}px) rotate(${rotate.toFixed(2)}deg) scale(${scale.toFixed(4)})`,
          opacity: Number(item?.opacity ?? 1) * (1 - intensity),
          filter,
          clipPath,
        };
      }
      function applyAnimatedObjectStyle(element, item, baseTransform) {
        const type = state.titles.includes(item) ? "text" : "image",
          visual = animationVisualState(item, type);
        element.style.transform = `${baseTransform}${visual.suffix}`;
        element.style.opacity = visual.opacity;
        element.style.filter = visual.filter;
        const cropTop = Number(item.cropTop || 0),
          cropBottom = Number(item.cropBottom || 0),
          cropLeft = Number(item.cropLeft || 0),
          cropRight = Number(item.cropRight || 0);
        if (cropTop || cropBottom || cropLeft || cropRight) {
          element.style.clipPath = `inset(${cropTop}% ${cropRight}% ${cropBottom}% ${cropLeft}%)`;
        } else {
          element.style.clipPath = visual.clipPath;
        }
        element.style.mixBlendMode = item.blendMode || "normal";
      }
      function captionAtTime(time = state.currentTime) {
        const t = Number(time || 0);
        const covering = (state.captions || []).filter(
          (item) =>
            state.trackVisibility[item.trackId || "caption"] !== false &&
            t >= Number(item.start) &&
            t <= Number(item.end),
        );
        if (!covering.length) return null;
        return covering.sort((left, right) => Number(right.start) - Number(left.start))[0];
      }
      function auxiliaryCaptionOffset(caption) {
        if (!caption) return 0;
        const style = state.captionStyle || {};
        const boxWidth = Number(state.captionTransform.width || state.width * 0.8);
        let mainHeight = Number(style.fontSize || 58) * Number(style.lineHeight || 1.15);
        try {
          mainHeight = Number(layoutCaptionForCanvas(caption, style, boxWidth, 1)?.boxHeight || mainHeight);
        } catch {
          // The estimate is sufficient while fonts are still loading.
        }
        const auxSize = Number(style.fontSize || 58) * Number(state.auxSubtitles?.fontScale || 0.62);
        return mainHeight / 2 + auxSize / 2 + Number(state.auxSubtitles?.gap || 18);
      }
      function renderAuxCaptionPreview(caption, px, py) {
        const preview = $("auxCaptionPreview");
        if (!preview) return;
        const text = String(caption?.auxText || "").trim();
        const visible = !!caption && !!text && state.auxSubtitles?.editorVisible !== false;
        preview.style.display = visible ? "block" : "none";
        if (!visible) {
          preview.textContent = "";
          return;
        }
        const style = state.captionStyle || {};
        const size = Number(style.fontSize || 58) * Number(state.auxSubtitles?.fontScale || 0.62);
        preview.textContent = text;
        preview.style.left = "50%";
        preview.style.top = "50%";
        preview.style.width = `${Number(state.captionTransform.width || state.width * 0.8) * px}px`;
        preview.style.fontFamily = `${style.fontFamily || "Helvetica"}, "PingFang SC", "Microsoft YaHei", sans-serif`;
        preview.style.fontSize = `${size * px}px`;
        preview.style.color = state.auxSubtitles?.color || "#e9edf2";
        preview.style.zIndex = String(Math.max(1, visualZ(caption.trackId || "caption") - 1));
        preview.style.transform = `translate(calc(-50% + ${state.captionTransform.x * px}px),calc(-50% + ${(state.captionTransform.y + auxiliaryCaptionOffset(caption)) * py}px)) scale(${state.captionTransform.scale || 1})`;
      }
      function renderPreviewObjects(force = true) {
        ensureIndependentTransforms();
        const layer = $("visualLayer");
        const activeVideoLayers = state.videoLayers.filter(
            (item) =>
              state.trackVisibility[item.trackId] !== false &&
              state.currentTime >= item.start &&
              state.currentTime <= item.end,
          ),
          activeImages = state.images
            .filter(
              (item) =>
                state.currentTime >= item.start && state.currentTime <= item.end,
            )
            .filter((item) => state.trackVisibility[item.trackId] !== false),
          activeTitles = state.titles
            .filter(
              (item) =>
                state.currentTime >= item.start && state.currentTime <= item.end,
            )
            .filter((item) => state.trackVisibility[item.trackId] !== false),
          caption = captionAtTime(state.currentTime),
          review = state.reviewCaptions.find(
            (item) =>
              state.currentTime >= item.start && state.currentTime <= item.end,
          ),
          sceneKey = JSON.stringify({
            videos: activeVideoLayers.map((item) => item.id),
            images: activeImages.map((item) => item.id),
            titles: activeTitles.map((item) => item.id),
            caption: caption?.id || "",
            review: review?.id || "",
            selected: selectionKey(state.selected.type, state.selected.id),
          });
        if (!force && sceneKey === previewSceneKey) {
          for (const item of activeVideoLayers)
            syncLayerVideoElement(
              layer.querySelector(`.layer-video[data-id="${item.id}"]`),
              item,
            );
          updateCaptionWordStates($("captionPreview"));
          for (const item of [...activeImages, ...activeTitles]) {
            const element = layer.querySelector(
              `[data-type="${state.titles.includes(item) ? "text" : "image"}"][data-id="${item.id}"]`,
            );
            if (!element) continue;
            if (element.tagName === "IMG" && item.sourceWidth && item.sourceHeight) {
              element.style.width = `${item.sourceWidth * ($("frame").clientWidth / state.width)}px`;
              element.style.height = `${item.sourceHeight * ($("frame").clientHeight / state.height)}px`;
            }
            const base = `translate(calc(-50% + ${Number(item.x || 0) * ($("frame").clientWidth / state.width)}px),calc(-50% + ${Number(item.y || 0) * ($("frame").clientHeight / state.height)}px)) rotate(${Number(item.rotation || 0)}deg) scale(${item.scale || 1})`;
            applyAnimatedObjectStyle(element, item, base);
          }
          updatePreviewTransformOnly(false);
          return;
        }
        const retainedVideos = new Map(
          [...layer.querySelectorAll(".layer-video[data-id]")].map((element) => [
            element.dataset.id,
            element,
          ]),
        );
        layer.replaceChildren();
        const fw = $("frame").clientWidth || 1,
          fh = $("frame").clientHeight || 1,
          px = fw / state.width,
          py = fh / state.height;
        const video = $("video");
        const activeMainClip = mainClips().find(
          (clip) => state.currentTime >= clip.start && state.currentTime <= clip.end,
        );
        const activeMainTrack = activeMainClip
          ? state.mainVideoTrackMap?.[activeMainClip.id] || "video"
          : "video";
        video.style.visibility =
          activeMainClip && state.trackVisibility[activeMainTrack] !== false
            ? "visible"
            : "hidden";
        video.style.zIndex = String(visualZ(activeMainTrack));
        const activeTransform = activeMainClip
          ? mainVideoSettings(activeMainClip)
          : defaultVisualTransform(state.videoTransform);
        video.style.transform = `translate(${activeTransform.x * px}px,${activeTransform.y * py}px) rotate(${activeTransform.rotation || 0}deg) scale(${activeTransform.scale})`;
        video.style.opacity = activeTransform.opacity ?? 1;
        video.style.mixBlendMode = activeTransform.blendMode || "normal";
        const mainCropTop = Number(activeTransform.cropTop || 0),
          mainCropBottom = Number(activeTransform.cropBottom || 0),
          mainCropLeft = Number(activeTransform.cropLeft || 0),
          mainCropRight = Number(activeTransform.cropRight || 0);
        video.style.clipPath = (mainCropTop || mainCropBottom || mainCropLeft || mainCropRight)
          ? `inset(${mainCropTop}% ${mainCropRight}% ${mainCropBottom}% ${mainCropLeft}%)`
          : "none";
        for (const item of activeVideoLayers) {
          const el = retainedVideos.get(item.id) || document.createElement("video");
          if (el.src !== item.url) el.src = item.url;
          el.muted = true;
          el.preload = "auto";
          el.className = `visualobject videoobject layer-video ${isSelected("videolayer", item.id) ? "selected" : ""}`;
          el.style.transform = `translate(calc(-50% + ${item.x * px}px),calc(-50% + ${item.y * py}px)) rotate(${Number(item.rotation || 0)}deg) scale(${item.scale || 1})`;
          el.style.opacity = item.opacity ?? 1;
          el.style.mixBlendMode = item.blendMode || "normal";
          const layerCropTop = Number(item.cropTop || 0),
            layerCropBottom = Number(item.cropBottom || 0),
            layerCropLeft = Number(item.cropLeft || 0),
            layerCropRight = Number(item.cropRight || 0);
          el.style.clipPath = (layerCropTop || layerCropBottom || layerCropLeft || layerCropRight)
            ? `inset(${layerCropTop}% ${layerCropRight}% ${layerCropBottom}% ${layerCropLeft}%)`
            : "none";
          el.dataset.type = "videolayer";
          el.dataset.id = item.id;
          el.style.zIndex = String(visualZ(item.trackId));
          syncLayerVideoElement(el, item);
          layer.appendChild(el);
        }
        for (const image of activeImages) {
          const el = document.createElement("img");
          el.src = image.url;
          el.className = `visualobject imageobject ${isSelected("image", image.id) ? "selected" : ""}`;
          if (image.sourceWidth && image.sourceHeight) {
            el.style.width = `${image.sourceWidth * px}px`;
            el.style.height = `${image.sourceHeight * py}px`;
          } else {
            const onMeasure = () => {
              if (el.naturalWidth && el.naturalHeight) {
                image.sourceWidth = el.naturalWidth;
                image.sourceHeight = el.naturalHeight;
                const fw = $("frame").clientWidth || 1;
                const fh = $("frame").clientHeight || 1;
                const currentPx = fw / Math.max(1, state.width);
                const currentPy = fh / Math.max(1, state.height);
                el.style.width = `${el.naturalWidth * currentPx}px`;
                el.style.height = `${el.naturalHeight * currentPy}px`;
                updateSelectionBox();
              }
            };
            if (el.complete && el.naturalWidth) {
              onMeasure();
            } else {
              el.onload = onMeasure;
            }
          }
          applyAnimatedObjectStyle(
            el,
            image,
            `translate(calc(-50% + ${image.x * px}px),calc(-50% + ${image.y * py}px)) rotate(${Number(image.rotation || 0)}deg) scale(${image.scale || 1})`,
          );
          el.dataset.type = "image";
          el.dataset.id = image.id;
          el.style.zIndex = String(visualZ(image.trackId));
          layer.appendChild(el);
        }
        for (const title of activeTitles) {
          const el = document.createElement("div");
          const s = title.style || state.captionStyle;
          el.className = `visualobject textobject ${isSelected("text", title.id) ? "selected" : ""}`;
          el.innerHTML = `<span class="textstyle-content">${escapeHtml(title.text).replace(/\n/g, "<br>")}</span>`;
          applyAnimatedObjectStyle(
            el,
            title,
            `translate(calc(-50% + ${title.x * px}px),calc(-50% + ${title.y * py}px)) rotate(${Number(title.rotation || 0)}deg) scale(${title.scale || 1})`,
          );
          applyTextStyle(el, s, px);
          applyTextBoxWidth(el, title.width, px);
          el.dataset.type = "text";
          el.dataset.id = title.id;
          el.style.zIndex = String(visualZ(title.trackId));
          layer.appendChild(el);
        }
        const preview = $("captionPreview");
        renderCaptionWords(preview, caption);
        preview.style.display =
          caption ? "block" : "none";
        preview.style.left = "50%";
        preview.style.top = "50%";
        preview.style.zIndex = String(visualZ(caption?.trackId || "caption"));
        preview.dataset.id = caption?.id || "track";
        preview.dataset.animation = state.captionStyle.animation || "fade";
        if (caption && preview.dataset.captionKey !== caption.id) {
          preview.dataset.captionKey = caption.id;
          preview.classList.remove("anim-enter");
          void preview.offsetWidth;
          preview.classList.add("anim-enter");
        }
        preview.style.setProperty(
          "--active",
          state.captionStyle.highlight || "#ffd21f",
        );
        preview.classList.toggle("no-highlight", state.captionStyle.highlightEnabled === false);
        const captionTransform = `translate(calc(-50% + ${state.captionTransform.x * px}px),calc(-50% + ${state.captionTransform.y * py}px)) scale(${state.captionTransform.scale || 1})`;
        preview.style.transform = captionTransform;
        preview.style.setProperty("--caption-transform", captionTransform);
        applyCaptionCanvasHost(preview, px);
        renderAuxCaptionPreview(caption, px, py);
        const reviewPreview = $("reviewPreview");
        reviewPreview.textContent = String(
          review?.expectedText && !/^\s*[—-]\s*$/.test(review.expectedText)
            ? review.expectedText
            : review?.text || "",
        ).replace(/^\s*(?:应为|建议删除)[:：]\s*/, "");
        reviewPreview.className = `visualobject reviewobject ${review?.type || ""}`;
        reviewPreview.dataset.id = review?.id || "";
        // 待处理标记只是剪辑控件，不是要导出的画面文字。
        reviewPreview.style.display = "none";
        reviewPreview.style.zIndex = String(visualZ("review"));
        reviewPreview.style.transform = reviewTransform(px, py);
        previewSceneKey = sceneKey;
        updateSelectionBox();
      }
      let captionPaintState = { key: "", layout: null, style: null, pad: 0, caption: null };
      