function assignOverlapLanes(items = []) {
        const sorted = items
          .map((item, index) => ({ item, index }))
          .sort((a, b) => Number(a.item.start || 0) - Number(b.item.start || 0));
        const laneEnds = [];
        const lanes = new Map();
        for (const { item, index } of sorted) {
          const start = Number(item.start || 0);
          const end = Math.max(start + 0.01, Number(item.end || start));
          let lane = 0;
          while (lane < laneEnds.length && start < laneEnds[lane] - 0.02) lane += 1;
          if (lane === laneEnds.length) {
            if (laneEnds.length >= 2) {
              lane = laneEnds.length - 1;
              laneEnds[lane] = Math.max(laneEnds[lane], end);
            } else {
              laneEnds.push(end);
            }
          } else laneEnds[lane] = end;
          lanes.set(item.id || `i${index}`, lane);
        }
        return { lanes, laneCount: Math.max(1, laneEnds.length) };
      }
      function clipGeometryStyle(clip, lane = 0, laneCount = 1) {
        const start = Number(clip.start || 0);
        const end = Math.max(start, Number(clip.end || start));
        const layered = laneCount > 1 ? `top:${3 + lane * 27}px;height:24px;` : "";
        return `left:${start * state.zoom}px;width:${Math.max(4, (end - start) * state.zoom)}px;${layered}`;
      }
      function playheadPinX(scroll) {
        const width = Math.max(1, scroll.clientWidth);
        return Math.max(72, Math.min(width * 0.3, width - 72));
      }
      function keepPlayheadInView(mode = "edge") {
        if (state.followPlayhead === false) return;
        const scroll = $("timelineScroll");
        if (!scroll || timelineDrag) return;
        const x = Number(state.currentTime || 0) * Number(state.zoom || 60);
        const viewWidth = Math.max(1, scroll.clientWidth);
        const viewLeft = scroll.scrollLeft;
        const viewRight = viewLeft + viewWidth;
        if (mode === "play") {
          const next = Math.max(0, x - playheadPinX(scroll));
          if (Math.abs(scroll.scrollLeft - next) > 0.4) scroll.scrollLeft = next;
          return;
        }
        if (mode === "center") {
          scroll.scrollLeft = Math.max(0, x - viewWidth / 2);
          return;
        }
        if (x < viewLeft + 8 || x > viewRight - 36)
          scroll.scrollLeft = Math.max(0, x - playheadPinX(scroll));
      }
      function syncFollowPlayheadButton() {
        const button = $("followPlayhead");
        if (!button) return;
        button.classList.toggle("primary", state.followPlayhead !== false);
      }
      function audioClipHtml(clip, type, trackId, lane = 0, laneCount = 1) {
        const settings =
            type === "audio" ? mainAudioSettings(clip) : clip,
          volume = settings?.muted ? 0 : clamp(Number(settings?.volume ?? 1), 0, 2),
          previewScale = Math.round(Math.max(0.03, volume / 2) * 100),
          preview = clip.previewUrl
            ? `background-image:url('${escapeHtml(clip.previewUrl)}');background-size:100% ${previewScale}%;background-position:center;`
            : "";
        const waveformCanvas =
          type === "audioasset" && Array.isArray(clip.waveform) && clip.waveform.length
            ? `<canvas class="assetwavecanvas" data-asset-waveform="${escapeHtml(clip.id)}"></canvas>`
            : "";
        const volumeTop = clamp((1 - volume / 2) * 100, 0, 100);
        return `<div class="clip audio ${clip.previewUrl ? "has-wave-preview" : ""} ${isSelected(type, clip.id) ? "selected" : ""}" data-type="${type}" data-id="${clip.id}" data-track-id="${trackId}" style="${clipGeometryStyle(clip, lane, laneCount)}${preview}--wave-scale:${Math.max(0.03, volume / 2)}"><i class="trim-handle start" data-trim="start"></i>${waveformCanvas}<i class="clip-volume-line" data-volume-line style="top:${volumeTop}%" title="拖动调整片段音量"></i><span class="clipname clip-sticky ellipsis">${escapeHtml(clip.name || "音频")}</span><i class="trim-handle end" data-trim="end"></i></div>`;
      }
      function clipHtml(c, type, lane = 0, laneCount = 1) {
        const visualType = type === "audioasset" ? "audio" : type;
        const issueClass = type === "review"
          ? ` ${c.type || "mismatch"}${c.scripture ? " scripture" : ""}`
          : "";
        const displayText = type === "review"
          ? reviewClipText(c)
          : String(c.text || c.name || type).replace(/^\s*(?:应为|建议删除)[:：]\s*/, "");
        const reviewAction = c.action === "missing"
          ? "missing"
          : ["accept", "insert"].includes(c.action)
            ? "insert"
            : "cut";
        const replace = type === "review"
          ? reviewAction === "missing"
            ? `<button class="review-replace" data-focus-issue="${escapeHtml(c.issueId || c.id)}" title="音频里没有读出这段内容，需要补录或自行决定是否保留">需补录</button>`
            : ""
          : "";
        const pixelWidth = Math.max(4, (Number(c.end || 0) - Number(c.start || 0)) * state.zoom);
        const narrow = pixelWidth < 72 ? " narrow" : "";
        const captionWords = type === "caption"
          ? (Array.isArray(c.words) && c.words.length
              ? c.words
              : displayText.split(/\s+/).filter(Boolean).map((display) => ({ display })))
              .map((word) => {
                const status = word.action === "cut"
                  ? "error"
                  : word.matchType === "near" || (word.issueType && word.action !== "cut")
                    ? "near"
                    : "match";
                const expected = String(word.expectedDisplay || "").trim();
                const issueId = String(word.issueId || ""),
                  action = issueId && word.action === "cut"
                    ? "cut"
                    : issueId && word.action === "replace"
                      ? "review"
                      : "",
                  actionClass = action ? ` action-${action}` : "",
                  actionAttribute = action
                    ? ` data-script-action="${action}" data-script-issue="${escapeHtml(issueId)}"`
                    : "",
                  tokenTitle = action === "cut"
                    ? "错读、多读或重复：点击试听，Ctrl+点击保留不删除，Shift+点击接受并删除这段"
                    : action === "review"
                      ? `读法有差异：点击定位；正确文案为 ${expected}`
                      : expected
                        ? `正确文案：${expected}`
                        : "";
                return `<span class="caption-token ${status}${actionClass}"${actionAttribute}${tokenTitle ? ` title="${escapeHtml(tokenTitle)}"` : ""}>${escapeHtml(word.display)}</span>`;
              })
              .join("")
          : `<span class="clipname ellipsis"${type === "review" ? reviewAction === "missing" ? ` data-focus-issue="${escapeHtml(c.issueId || c.id)}" title="${escapeHtml(reviewClipTitle(c))}"` : reviewAction === "insert" ? ` data-insert-review="${escapeHtml(c.id)}" title="不改变原意的口语补充：点击插入正确字幕轨道"` : ` data-cut-review="${escapeHtml(c.id)}" title="${escapeHtml(reviewClipTitle(c))}"` : ""}>${escapeHtml(displayText)}</span>`;
        const actionClass = type === "review" ? ` ${reviewAction}` : "";
        const reviewHit =
          type !== "review"
            ? ""
            : reviewAction === "missing"
              ? ` data-focus-issue="${escapeHtml(c.issueId || c.id)}"`
              : reviewAction === "insert"
                ? ` data-insert-review="${escapeHtml(c.id)}"`
                : ` data-cut-review="${escapeHtml(c.id)}"`;
        const inner = type === "caption" || type === "review"
          ? `<span class="clip-sticky">${captionWords}</span>`
          : `<span class="clip-sticky">${captionWords}</span>`;
        const soloMark = type === "caption" && Array.isArray(c.words) && c.words.some(w => w.userKeptSolo)
          ? `<span class="solo-kept-mark" style="position:absolute;left:0;top:0;bottom:0;width:2px;background:#4ade80;border-radius:1px;z-index:2"></span>`
          : "";
        return `<div class="clip ${visualType}${issueClass}${actionClass}${narrow} ${isSelected(type, c.id) ? "selected" : ""}" data-type="${type}" data-id="${c.id}" data-track-id="${escapeHtml(c.trackId || (type === "review" ? "review" : type))}"${reviewHit} title="${escapeHtml(type === "review" ? reviewClipTitle(c) : displayText)}" style="${clipGeometryStyle(c, lane, laneCount)}"><i class="trim-handle start" data-trim="start"></i>${soloMark}${inner}${replace}<i class="trim-handle end" data-trim="end"></i></div>`;
      }
      function drawWaveform() {
        const scroll = $("timelineScroll"),
          viewLeft = Math.max(0, scroll.scrollLeft),
          viewWidth = Math.max(1, scroll.clientWidth),
          waveform = state.waveform || [],
          sourceDuration = Math.max(0.001, Number(state.sourceDuration || 0));
        for (const canvas of document.querySelectorAll("[data-main-wave-track]")) {
          const trackId = canvas.dataset.mainWaveTrack || "audio";
          const row = canvas.closest(".trackrow");
          if (!row) continue;
          const dpr = devicePixelRatio || 1,
            width = viewWidth,
            height = Math.max(1, row.clientHeight);
          canvas.style.left = `${viewLeft}px`;
          canvas.style.width = `${width}px`;
          canvas.style.right = "auto";
          canvas.width = Math.max(1, Math.round(width * dpr));
          canvas.height = Math.max(1, Math.round(height * dpr));
          const ctx = canvas.getContext("2d");
          ctx.scale(dpr, dpr);
          ctx.clearRect(0, 0, width, height);
          if (!waveform.length || !sourceDuration) continue;
          const clips = mainAudioClips().filter(
            (item) => (state.mainAudioTrackMap?.[item.id] || "audio") === trackId,
          );
          drawWaveformWindow(ctx, {
            width,
            height,
            waveform,
            sourceDuration,
            timelineStart: viewLeft / state.zoom,
            secondsPerPixel: 1 / state.zoom,
            clips,
            volumeForClip: (clip, displayTime) => {
              const settings = mainAudioSettings(clip, false);
              const muted = settings?.muted || state.audioMutes.some(
                (range) => displayTime >= range.start && displayTime <= range.end,
              );
              return muted || !isTrackAudible(trackId)
                ? 0
                : clamp(Number(state.audio.volume ?? 1) * Number(settings?.volume ?? 1), 0, 2.5);
            },
          });
        }
      }
      function waveformPeakRange(waveform, from, to, channelOffset = 0) {
        const start = clamp(Math.floor(from), 0, Math.max(0, waveform.length - 1));
        const end = clamp(Math.max(start + 1, Math.ceil(to)), 1, waveform.length);
        let low = 0, high = 0;
        for (let index = start; index < end; index += 1) {
          const point = waveform[index] || [];
          low = Math.min(low, Number(point[channelOffset] || 0));
          high = Math.max(high, Number(point[channelOffset + 1] || 0));
        }
        return [low, high];
      }
      function drawWaveformWindow(ctx, options) {
        const { width, height, waveform, sourceDuration, timelineStart, secondsPerPixel, clips } = options;
        const stereo = (waveform[0]?.length || 0) >= 4;
        const channels = stereo ? 2 : 1;
        const speed = Math.max(0.05, Number(state.audio.speed || 1));
        ctx.lineWidth = 1;
        ctx.lineCap = "butt";
        ctx.strokeStyle = "rgba(66, 239, 188, 0.95)";
        for (let channel = 0; channel < channels; channel += 1) {
          const bandHeight = height / channels,
            center = bandHeight * channel + bandHeight / 2,
            half = Math.max(2, bandHeight / 2 - 4);
          ctx.globalAlpha = 0.18;
          ctx.beginPath(); ctx.moveTo(0, center + .5); ctx.lineTo(width, center + .5); ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.beginPath();
          for (let x = .5; x < width; x += 1) {
            const displayTime = timelineStart + x * secondsPerPixel;
            const clip = clips.find((item) => displayTime >= item.start - .002 && displayTime <= item.end + .002);
            if (!clip) continue;
            const sourceStart = Number(clip.sourceStart || 0) + (displayTime - clip.start) * speed;
            const sourceEnd = sourceStart + secondsPerPixel * speed;
            const from = sourceStart / sourceDuration * waveform.length;
            const to = sourceEnd / sourceDuration * waveform.length;
            const [low, high] = waveformPeakRange(waveform, from, to, channel * 2);
            const gain = Number(options.volumeForClip?.(clip, displayTime) ?? 1);
            const shapedLow = Math.sign(low) * Math.pow(Math.abs(low), .72) * half * gain;
            const shapedHigh = Math.sign(high) * Math.pow(Math.abs(high), .72) * half * gain;
            ctx.moveTo(x, center - shapedHigh);
            ctx.lineTo(x, center - shapedLow);
          }
          ctx.stroke();
        }
      }
      function showTrimAudioDetail() {
        return; // 已按需求取消音频放大遮挡效果
      }
      function hideTrimAudioDetail() {
        $("trimAudioDetail")?.classList.remove("on");
      }
      function drawAssetWaveforms() {
        for (const canvas of document.querySelectorAll("[data-asset-waveform]")) {
          const asset = state.audioAssets.find(
            (item) => item.id === canvas.dataset.assetWaveform,
          );
          if (!asset?.waveform?.length) continue;
          const width = Math.max(1, canvas.clientWidth);
          const height = Math.max(1, canvas.clientHeight);
          const dpr = devicePixelRatio || 1;
          canvas.width = Math.round(width * dpr);
          canvas.height = Math.round(height * dpr);
          const ctx = canvas.getContext("2d");
          ctx.scale(dpr, dpr);
          ctx.clearRect(0, 0, width, height);
          const sourceDuration = Math.max(
            0.04,
            Number(asset.sourceDuration || asset.duration || asset.end - asset.start),
          );
          const clipDuration = Math.max(0.04, asset.end - asset.start);
          drawWaveformWindow(ctx, {
            width,
            height,
            waveform: asset.waveform,
            sourceDuration,
            timelineStart: Number(asset.start || 0),
            secondsPerPixel: clipDuration / width,
            clips: [asset],
            volumeForClip: () => asset.muted || !isTrackAudible(asset.trackId)
              ? 0
              : clamp(Number(asset.volume ?? 1), 0, 2.5),
          });
        }
      }
      