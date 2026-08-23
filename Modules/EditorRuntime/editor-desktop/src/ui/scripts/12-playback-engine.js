      let activeVideo = null;
      let standbyVideo = null;
      let standbyPreloadedId = null;
      let playbackAnimationFrame = 0;
      let gapPlayback = null;
      let sourceSeekGeneration = 0;

      function getActiveVideo() {
        if (!activeVideo) activeVideo = $("video");
        return activeVideo || $("video");
      }
      function getStandbyVideo() {
        if (!standbyVideo) standbyVideo = $("videoAlt");
        return standbyVideo || $("videoAlt");
      }
      function syncDualVideoSources(url) {
        const v1 = $("video");
        const v2 = $("videoAlt");
        if (!v1) return;
        if (url) {
          if (v1.dataset.sourceUrl !== url) {
            v1.dataset.sourceUrl = url;
            v1.src = url;
          }
          if (v2 && v2.dataset.sourceUrl !== url) {
            v2.dataset.sourceUrl = url;
            v2.src = url;
          }
          $("stage")?.classList.remove("empty");
        } else {
          v1.pause(); v1.removeAttribute("src"); v1.dataset.sourceUrl = ""; v1.load?.();
          if (v2) { v2.pause(); v2.removeAttribute("src"); v2.dataset.sourceUrl = ""; v2.load?.(); }
        }
      }

      function renderAll() {
        syncCaptionLineButtons();
        syncAuxSubtitleControls();
        normalizeSelection();
        ensureIndependentTransforms();
        syncDualVideoSources(state.video?.url || "");
        mediaList();
        renderPreviewObjects();
        renderTimeline();
        renderIssues();
        renderCaptionInspector();
        updateInspector();
        applyVideoCss();
        syncAudioControls();
        syncPreviewAudio();
        $("linkAV").classList.toggle("primary", state.avLinked);
        $("snapToggle").classList.toggle("primary", state.snapping);
        if ($("selectionFollowsPlayhead")) $("selectionFollowsPlayhead").classList.toggle("active", state.selectionFollowsPlayhead);
        $("timecode").textContent =
          `${formatTime(state.currentTime)} / ${formatTime(state.duration)}`;
        $("play").textContent = state.playing ? "❚❚" : "▶";
        syncFollowPlayheadButton();
        queueAutosave();
      }

      function seekTimeline(time) {
        state.currentTime = clamp(time, 0, visibleTimelineDuration());
        const primary = getActiveVideo();
        if (state.video && primary) {
          const source = timelineToSource(state.currentTime);
          if (Math.abs(primary.currentTime - source) > 0.08) {
            primary.currentTime = source;
          }
          standbyPreloadedId = null;
        }
        renderPreviewObjects(false);
        syncPreviewAudio();
        syncTimelineChrome();
        $("timecode").textContent =
          `${formatTime(state.currentTime)} / ${formatTime(state.duration)}`;
        keepPlayheadInView(state.playing ? "play" : "edge");
        if (state.selectionFollowsPlayhead && !state.playing) scheduleSelectionFollowsPlayhead();
      }

      let selectionFollowFrame = 0;
      function scheduleSelectionFollowsPlayhead() {
        if (selectionFollowFrame) return;
        selectionFollowFrame = requestAnimationFrame(() => {
          selectionFollowFrame = 0;
          if (!state.selectionFollowsPlayhead || state.playing) return;
          const candidates = clipsUnderPlayhead(state.currentTime).filter((item) => {
            const trackId = selectionTrackId(item.type, item.id);
            return isTrackAutoSelected(trackId) && state.trackVisibility?.[trackId] !== false;
          }).sort((a, b) => state.trackOrder.indexOf(selectionTrackId(a.type, a.id)) - state.trackOrder.indexOf(selectionTrackId(b.type, b.id)));
          if (!candidates.length) return;
          const next = expandLinkedSelection([candidates[0]]).filter((item) => isTrackAutoSelected(selectionTrackId(item.type, item.id)));
          const before = (state.selectedItems || []).map((item) => `${item.type}:${item.id}`).sort().join("|");
          const after = next.map((item) => `${item.type}:${item.id}`).sort().join("|");
          if (before === after) return;
          state.selectedItems = next; state.selected = next[0] || state.selected;
          renderTimeline(); renderPreviewObjects(); updateInspector();
        });
      }

      function swapDualVideo(targetTime) {
        const cur = getActiveVideo();
        const next = getStandbyVideo();
        if (!next || !cur || next === cur) {
          if (cur) cur.currentTime = targetTime;
          return;
        }
        applyMediaPlaybackRate(next);
        next.muted = cur.muted;
        next.volume = cur.volume;
        if (state.playing) {
          next.play().catch(() => {});
        }
        cur.pause();
        next.style.opacity = "1";
        next.style.pointerEvents = "auto";
        cur.style.opacity = "0";
        cur.style.pointerEvents = "none";

        activeVideo = next;
        standbyVideo = cur;
        standbyPreloadedId = null;

        if (typeof drawBeautyPreview === "function" && beautyIsActive()) {
          drawBeautyPreview();
        }
      }

      function jumpPlaybackSource(fromSource) {
        const video = getActiveVideo();
        const target = skipDeadSource(fromSource);
        if (target <= fromSource + 0.012) return fromSource;
        if (video.seeking) return target;
        const token = ++sourceSeekGeneration;
        const resume = () => {
          if (token !== sourceSeekGeneration) return;
          if (gapPlayback) return;
          if (state.playing && video.paused) video.play().catch(() => {});
        };
        video.addEventListener("seeked", resume, { once: true });
        video.currentTime = target;
        return target;
      }

      function startPlaybackAnimationLoop() {
        if (playbackAnimationFrame) return;
        const tick = () => {
          if (!state.playing) {
            playbackAnimationFrame = 0;
            gapPlayback = null;
            return;
          }
          // ── 间隙播放：video 已暂停，用墙钟推进时间线 ──
          if (gapPlayback) {
            const speed = Math.max(0.05, Number(state.playbackSpeed || 1));
            const elapsed = (performance.now() - gapPlayback.startWall) / 1000 * speed;
            const now = gapPlayback.startTimeline + elapsed;
            if (now >= gapPlayback.gapEnd - 0.01) {
              // 间隙结束，恢复视频播放
              state.currentTime = gapPlayback.gapEnd;
              gapPlayback = null;
              const clips = mainClips();
              const clip = clips.find(
                (c) => state.currentTime >= c.start && state.currentTime < c.end + 0.01,
              );
              if (clip) {
                const video = getActiveVideo();
                video.currentTime = clip.sourceStart;
                if (video.paused) video.play().catch(() => {});
              }
            } else {
              state.currentTime = now;
            }
            if (state.currentTime >= state.duration - 0.03) {
              state.playing = false;
              getActiveVideo().pause();
              $("play").textContent = "▶";
              playbackAnimationFrame = 0;
              gapPlayback = null;
              return;
            }
            schedulePreviewRender(false);
            syncPlayheadPosition();
            $("timecode").textContent =
              `${formatTime(state.currentTime)} / ${formatTime(state.duration)}`;
            keepPlayheadInView("play");
            playbackAnimationFrame = requestAnimationFrame(tick);
            return;
          }

          const video = getActiveVideo();
          const standby = getStandbyVideo();
          const source = Number(video.currentTime || 0);
          const live = video.seeking ? skipDeadSource(source) : jumpPlaybackSource(source);
          state.currentTime = mapSourceTime(live);

          const clips = mainClips();
          const curIndex = clips.findIndex(
            (c) => state.currentTime >= c.start && state.currentTime < c.end + 0.01,
          );
          const curClip = curIndex >= 0 ? clips[curIndex] : null;
          const nextClip = curIndex >= 0 && curIndex < clips.length - 1 ? clips[curIndex + 1] : null;

          // ── 达芬奇式双缓冲：提前 350ms 在备用解码器上预寻道下一切片首帧 ──
          if (curClip && nextClip && standby && (curClip.end - state.currentTime) < 0.38) {
            if (standbyPreloadedId !== nextClip.id) {
              standbyPreloadedId = nextClip.id;
              if (standby.src) {
                standby.currentTime = nextClip.sourceStart;
              }
            }
          }

          // ── 切片接力瞬间：0ms 延迟无缝切换到备用视频 ──
          if (curClip && nextClip && standby && state.currentTime >= curClip.end - 0.018) {
            state.currentTime = nextClip.start;
            swapDualVideo(nextClip.sourceStart);
          }

          // ── 检测是否进入了间隙 ──
          const inClip = !!curClip;
          if (!inClip && state.currentTime < state.duration - 0.05) {
            const nextUpcoming = clips.find((c) => c.start > state.currentTime + 0.001);
            if (nextUpcoming) {
              video.pause();
              gapPlayback = {
                gapEnd: nextUpcoming.start,
                startWall: performance.now(),
                startTimeline: state.currentTime,
              };
            }
          }
          if (state.currentTime >= state.duration - 0.03) {
            state.playing = false;
            video.pause();
            if (standby) standby.pause();
            $("play").textContent = "▶";
            playbackAnimationFrame = 0;
            gapPlayback = null;
            return;
          }
          schedulePreviewRender(false);
          syncPlayheadPosition();
          $("timecode").textContent =
            `${formatTime(state.currentTime)} / ${formatTime(state.duration)}`;
          keepPlayheadInView("play");
          playbackAnimationFrame = requestAnimationFrame(tick);
        };
        playbackAnimationFrame = requestAnimationFrame(tick);
      }
      let shuttleSpeed = 0;
      let shuttleTimer = null;
      function effectivePlaybackRate(baseSpeed = 1) {
        const previewRate = Number(state.playbackSpeed || 1);
        const clipRate = Number(baseSpeed || state.audio?.speed || 1);
        const shuttle = shuttleSpeed ? Math.abs(shuttleSpeed) : 1;
        return clamp(previewRate * clipRate * shuttle, 0.25, 16);
      }
      function applyMediaPlaybackRate(mediaEl, baseSpeed = 1) {
        if (!mediaEl) return;
        const rate = effectivePlaybackRate(baseSpeed);
        mediaEl.playbackRate = rate;
        if (mediaEl.preservesPitch !== undefined) mediaEl.preservesPitch = true;
        if (mediaEl.webkitPreservesPitch !== undefined) mediaEl.webkitPreservesPitch = true;
        if (mediaEl.mozPreservesPitch !== undefined) mediaEl.mozPreservesPitch = true;
      }
      const PLAYBACK_SPEED_TIERS = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0];
      function setPlaybackSpeed(speed, notify = true) {
        const val = clamp(Number(speed) || 1.0, 0.25, 8.0);
        state.playbackSpeed = val;
        const btn = $("playbackSpeedBtn");
        if (btn) {
          const text = val % 1 === 0 ? `${val.toFixed(1)}×` : `${val}×`;
          btn.textContent = text;
          btn.classList.toggle("speed-boosted", val !== 1.0);
        }
        const select = $("playbackSpeedSelect");
        if (select) {
          select.value = String(val);
        }
        applyMediaPlaybackRate($("video"));
        applyMediaPlaybackRate($("videoAlt"));
        for (const player of previewAudioPlayers.values()) {
          applyMediaPlaybackRate(player);
        }
        if (notify) toast(`⚡ 播放倍速：${val}×`);
      }
      function stepPlaybackSpeed(direction = 1) {
        const current = Number(state.playbackSpeed || 1.0);
        let idx = PLAYBACK_SPEED_TIERS.findIndex(s => Math.abs(s - current) < 0.05);
        if (idx === -1) {
          idx = PLAYBACK_SPEED_TIERS.findIndex(s => s >= current);
          if (idx === -1) idx = PLAYBACK_SPEED_TIERS.length - 1;
        }
        const nextIdx = clamp(idx + direction, 0, PLAYBACK_SPEED_TIERS.length - 1);
        setPlaybackSpeed(PLAYBACK_SPEED_TIERS[nextIdx], true);
      }
      function stopShuttle(pauseVideo = true) {
        if (shuttleTimer) {
          clearInterval(shuttleTimer);
          shuttleTimer = null;
        }
        shuttleSpeed = 0;
        if (pauseVideo && state.playing) {
          getActiveVideo().pause();
          getStandbyVideo()?.pause();
          state.playing = false;
          gapPlayback = null;
          $("play").textContent = "▶";
          syncPreviewAudio();
          renderPreviewObjects(false);
        }
        applyMediaPlaybackRate($("video"));
        applyMediaPlaybackRate($("videoAlt"));
      }
      function handleShuttleKey(key) {
        if (!state.video) return;
        if (key === "KeyK") {
          stopShuttle(true);
          toast("暂停 (K)");
          return;
        }
        if (key === "KeyL") {
          if (shuttleTimer) {
            clearInterval(shuttleTimer);
            shuttleTimer = null;
          }
          if (shuttleSpeed <= 0) {
            shuttleSpeed = 1;
          } else if (shuttleSpeed < 16) {
            shuttleSpeed *= 2;
          }
          if (!state.playing) {
            state.playing = true;
            getActiveVideo().play().catch(() => {});
            startPlaybackAnimationLoop();
            $("play").textContent = "❚❚";
          }
          applyMediaPlaybackRate($("video"));
          applyMediaPlaybackRate($("videoAlt"));
          toast(`⚡ 快进穿梭播放：${shuttleSpeed}x (L)`);
          return;
        }
        if (key === "KeyJ") {
          if (shuttleSpeed > 1) {
            shuttleSpeed = Math.floor(shuttleSpeed / 2);
            applyMediaPlaybackRate($("video"));
            applyMediaPlaybackRate($("videoAlt"));
            toast(`⚡ 快进穿梭播放：${shuttleSpeed}x (L)`);
            return;
          }
          if (state.playing) {
            getActiveVideo().pause();
            getStandbyVideo()?.pause();
            state.playing = false;
            $("play").textContent = "▶";
          }
          if (shuttleSpeed >= 0) {
            shuttleSpeed = -1;
          } else if (shuttleSpeed > -16) {
            shuttleSpeed *= 2;
          }
          if (shuttleTimer) clearInterval(shuttleTimer);
          const absSpeed = Math.abs(shuttleSpeed);
          const stepInterval = 40;
          const stepDuration = (stepInterval / 1000) * absSpeed;
          shuttleTimer = setInterval(() => {
            const next = state.currentTime - stepDuration;
            if (next <= 0) {
              seekTimeline(0);
              stopShuttle(true);
            } else {
              seekTimeline(next);
            }
          }, stepInterval);
          toast(`⏪ 倒放穿梭：${absSpeed}x (J)`);
        }
      }
      async function togglePlay() {
        if (!state.video) return;
        if (shuttleTimer) {
          clearInterval(shuttleTimer);
          shuttleTimer = null;
        }
        shuttleSpeed = 0;
        applyMediaPlaybackRate($("video"));
        applyMediaPlaybackRate($("videoAlt"));
        if (state.playing) {
          getActiveVideo().pause();
          getStandbyVideo()?.pause();
          state.playing = false;
          gapPlayback = null;
          syncPreviewAudio();
          renderPreviewObjects(false);
          $("play").textContent = "▶";
          return;
        }
        const playable = mainClips();
        if (state.currentTime >= state.duration - 0.03) seekTimeline(0);
        const inClipAtPlay = playable.some(
          (clip) => state.currentTime >= clip.start && state.currentTime < clip.end,
        );
        if (!inClipAtPlay) {
          // 播放头在间隙中 — 初始化间隙播放，不跳到下一个 clip
          const next = playable.find((clip) => clip.start > state.currentTime + 0.001);
          gapPlayback = {
            gapEnd: next ? next.start : state.duration,
            startWall: performance.now(),
            startTimeline: state.currentTime,
          };
        }
        state.playing = true;
        applyMediaPlaybackRate($("video"));
        applyMediaPlaybackRate($("videoAlt"));
        if (inClipAtPlay) await getActiveVideo().play();
        keepPlayheadInView("play");
        updateBeautyPreviewState();
        startPlaybackAnimationLoop();
        syncPreviewAudio();
        renderPreviewObjects(false);
        $("play").textContent = "❚❚";
      }

      function wireVideoEvents(v) {
        if (!v) return;
        v.onloadedmetadata = () => {
          if (!state.video || !Number.isFinite(v.duration)) return;
          const duration = Number(v.duration || 0);
          if (duration <= 0 || Math.abs(duration - state.sourceDuration) < 0.01)
            return;
          state.sourceDuration = duration;
          state.video.duration = duration;
          state.video.analysisPending = !!state.video.analysisJobId;
          recomputeContentDuration();
          state.timelineDuration = Math.max(60, state.duration + 10);
          renderAll();
        };
        v.onseeked = () => {
          if (state.playing && !gapPlayback && v === getActiveVideo() && v.paused) {
            v.play().catch(() => {});
          }
          if (beautyIsActive() && !beautyFrameRequest)
            beautyFrameRequest = requestAnimationFrame(drawBeautyPreview);
        };
        v.onloadeddata = () => {
          if (beautyIsActive() && !beautyFrameRequest)
            beautyFrameRequest = requestAnimationFrame(drawBeautyPreview);
        };
        v.ontimeupdate = () => {
          if (!state.playing || v !== getActiveVideo() || v.seeking || gapPlayback) return;
          const source = Number(v.currentTime || 0);
          if ((state.removals || []).some((range) => source >= range.start && source < range.end))
            return;
          state.currentTime = mapSourceTime(source);
          if (state.currentTime >= state.duration - 0.03) {
            if (state.loopPlayback) {
              seekTimeline(0);
            } else {
              state.playing = false;
              v.pause();
              getStandbyVideo()?.pause();
              $("play").textContent = "▶";
            }
          }
          syncPreviewAudio();
        };
        v.onended = () => {
          if (v !== getActiveVideo()) return;
          if (state.loopPlayback) {
            seekTimeline(0);
            v.play().catch(() => {});
          } else {
            state.playing = false;
            syncPreviewAudio();
            renderPreviewObjects(false);
            $("play").textContent = "▶";
          }
        };
      }
      wireVideoEvents($("video"));
      wireVideoEvents($("videoAlt"));
      const previewAudioPlayers = new Map();
      function previewAudioPlayer(key, url) {
        let player = previewAudioPlayers.get(key);
        if (!player) {
          player = document.createElement("audio");
          player.preload = "auto";
          $("audioPreviewLayer").appendChild(player);
          previewAudioPlayers.set(key, player);
        }
        if (url && player.src !== url) player.src = url;
        return player;
      }
      function syncOneAudio(player, sourceTime, active, options = {}) {
        if (!active) {
          player.pause();
          return;
        }
        player.volume = clamp(Number(options.volume ?? 1), 0, 1);
        applyMediaPlaybackRate(player, Number(options.speed ?? 1));
        if (Math.abs(Number(player.currentTime || 0) - sourceTime) > 0.14)
          player.currentTime = Math.max(0, sourceTime);
        if (state.playing || rulerScrub) player.play().catch(() => {});
        else player.pause();
      }
      function clipFadeGain(settings, clip, time) {
        if (!settings || !clip) return 1;
        const fadeIn = Math.min(
            Math.max(0, Number(settings.fadeIn || 0)),
            Math.max(0, clip.end - clip.start),
          ),
          fadeOut = Math.min(
            Math.max(0, Number(settings.fadeOut || 0)),
            Math.max(0, clip.end - clip.start),
          );
        let gain = 1;
        if (fadeIn > 0) gain = Math.min(gain, (time - clip.start) / fadeIn);
        if (fadeOut > 0) gain = Math.min(gain, (clip.end - time) / fadeOut);
        return clamp(gain, 0, 1);
      }
      function syncPreviewAudio() {
        const mainClip = mainAudioClips().find(
            (clip) =>
              state.currentTime >= clip.start && state.currentTime <= clip.end,
          ),
          mainSettings = mainClip ? mainAudioSettings(mainClip) : null,
          mainTrackVisible = mainClip
            ? isTrackAudible(state.mainAudioTrackMap?.[mainClip.id] || "audio")
            : isTrackAudible("audio"),
          mainMuted =
            mainSettings?.muted ||
            state.audioMutes.some(
              (range) =>
                state.currentTime >= range.start && state.currentTime <= range.end,
            ),
          mainGain =
            Number(state.audio.volume ?? 1) *
            Number(mainSettings?.volume ?? 1) *
            clipFadeGain(mainSettings, mainClip, state.currentTime);
        const vMuted = !mainTrackVisible || !state.avLinked || !!mainMuted || !!state.denoisedAudio || !!rulerScrub;
        const vVol = clamp(mainGain, 0, 1);
        const v1 = $("video");
        const v2 = $("videoAlt");
        if (v1) { v1.muted = vMuted; v1.volume = vVol; }
        if (v2) { v2.muted = vMuted; v2.volume = vVol; }
        const main = previewAudioPlayer(
          "main",
          state.denoisedAudio?.url || state.video?.url || "",
        );
        if (state.video && (!state.avLinked || state.denoisedAudio || rulerScrub)) {
          const active = !!mainClip && mainTrackVisible;
          const sourceTime = mainClip
            ? Number(mainClip.sourceStart || 0) +
              Math.max(0, state.currentTime - mainClip.start) *
                Math.max(0.05, Number(state.audio.speed || 1))
            : 0;
          syncOneAudio(main, sourceTime, active, {
            volume: mainMuted ? 0 : Math.min(1, mainGain),
            speed: state.audio.speed,
          });
        } else main.pause();
        const activeIds = new Set();
        for (const asset of state.audioAssets) {
          activeIds.add(asset.id);
          const player = previewAudioPlayer(asset.id, asset.url);
          const active =
            isTrackAudible(asset.trackId) &&
            state.currentTime >= asset.start &&
            state.currentTime <= asset.end;
          const sourceTime =
            Number(asset.sourceStart || 0) +
            Math.max(0, state.currentTime - asset.start) *
              Number(state.audio.speed || 1);
          syncOneAudio(player, sourceTime, active, {
            volume: asset.muted
              ? 0
              : Number(state.audio.volume ?? 1) *
                Number(asset.volume ?? 1) *
                clipFadeGain(asset, asset, state.currentTime),
            speed: state.audio.speed,
          });
        }
        for (const [key, player] of previewAudioPlayers)
          if (key !== "main" && !activeIds.has(key)) {
            player.pause();
            player.remove();
            previewAudioPlayers.delete(key);
          }
      }
      