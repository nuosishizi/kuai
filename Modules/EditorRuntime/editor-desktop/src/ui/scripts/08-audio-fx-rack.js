function mainAudioSettings(clip, create = true) {
        if (!clip) return null;
        if (!state.mainAudioClipSettings[clip.id] && create)
          state.mainAudioClipSettings[clip.id] = {
            volume: 1,
            pan: 0,
            fadeIn: 0,
            fadeOut: 0,
            muted: false,
          };
        return state.mainAudioClipSettings[clip.id] || null;
      }
      function audioSettingsFor(type, id, create = true) {
        if (type === "audio") {
          const clip = mainAudioClips().find((item) => item.id === id);
          return clip ? mainAudioSettings(clip, create) : null;
        }
        if (type === "audioasset")
          return state.audioAssets.find((item) => item.id === id) || null;
        return null;
      }
      function currentAudioFxTarget(create = true) {
        state.audioFxRack = normalizeAudioFxRack(state.audioFxRack);
        if (state.audioFxScope !== "clip")
          return { scope: "track", rack: state.audioFxRack, bypass: !!state.audioFxBypass };
        const settings = audioSettingsFor(state.selected.type, state.selected.id, create);
        if (!settings) return null;
        if (create) settings.fxRack = normalizeAudioFxRack(settings.fxRack);
        return {
          scope: "clip",
          rack: create ? settings.fxRack : normalizeAudioFxRack(settings.fxRack),
          settings,
          bypass: !!settings.fxBypass,
        };
      }
      function setCurrentAudioFxRack(rack) {
        const normalized = normalizeAudioFxRack(rack);
        if (state.audioFxScope === "clip") {
          const settings = audioSettingsFor(state.selected.type, state.selected.id, true);
          if (!settings) return false;
          settings.fxRack = normalized;
        } else state.audioFxRack = normalized;
        return true;
      }
      function audioFxControl(label, key, value, minimum, maximum, step = 1, unit = "", scale = 1) {
        const shown = Number(value || 0) * scale;
        return `<div class="audio-fx-control"><label><span>${label}</span><span data-fx-value="${key}">${Number(shown.toFixed(step < 1 ? 2 : 1))}${unit}</span></label><input class="range" type="range" min="${minimum}" max="${maximum}" step="${step}" value="${shown}" data-fx-param="${key}" data-fx-scale="${scale}"></div>`;
      }
      function audioFxBody(effect) {
        const p = effect.params || {};
        if (effect.type === "voice-isolation") return `<div class="audio-fx-grid">
          ${audioFxControl("隔离强度", "amount", p.amount, 0, 100, 1, "%", 100)}
          ${audioFxControl("人声保护", "voiceProtect", p.voiceProtect, 0, 100, 1, "%", 100)}
          ${audioFxControl("伪影抑制", "artifactControl", p.artifactControl, 0, 100, 1, "%", 100)}
        </div><div class="small">RNNoise 人声增强加轻量频谱残留清理；不会使用 Blackmagic 私有模型。</div>`;
        if (effect.type === "noise-reduction") {
          const learned = Array.isArray(p.learnedBands) && p.learnedBands.length === 15;
          return `<div class="audio-fx-grid">
            <div class="audio-fx-control"><label><span>检测模式</span></label><select class="select" data-fx-param="mode"><option value="auto" ${p.mode !== "learn" ? "selected" : ""}>自动检测</option><option value="learn" ${p.mode === "learn" ? "selected" : ""}>学习的噪声</option></select></div>
            ${audioFxControl("降低量", "reductionDb", p.reductionDb, .1, 32, .5, " dB")}
            ${audioFxControl("噪声底", "noiseFloorDb", p.noiseFloorDb, -80, -20, 1, " dB")}
            ${audioFxControl("灵敏度", "sensitivity", p.sensitivity, 0, 100, 1, "%", 100)}
            ${audioFxControl("频谱平滑", "smoothing", p.smoothing, 0, 50, 1)}
            ${audioFxControl("起音", "attackMs", p.attackMs, 1, 500, 1, " ms")}
            ${audioFxControl("释放", "releaseMs", p.releaseMs, 20, 2000, 10, " ms")}
          </div><div class="field audio-fx-action"><button class="btn" type="button" data-fx-learn="${effect.id}">学习时间线选区噪声</button><span class="small ${learned ? "audio-fx-learned" : ""}">${learned ? `已学习 ${Number(p.learnedDuration || 0).toFixed(1)} 秒 · ${Number(p.noiseFloorDb || -50).toFixed(0)} dB` : "先框选一段只有噪声的区域；无选区时从播放头学习 2 秒"}</span></div>`;
        }
        if (effect.type === "de-hummer") return `<div class="audio-fx-grid">
          <div class="audio-fx-control"><label><span>工频</span><span>${p.detectedFrequency ? `检测 ${p.detectedFrequency} Hz` : ""}</span></label><select class="select" data-fx-param="frequency"><option value="auto" ${p.frequency === "auto" ? "selected" : ""}>自动 50/60 Hz</option><option value="50" ${String(p.frequency) === "50" ? "selected" : ""}>50 Hz</option><option value="60" ${String(p.frequency) === "60" ? "selected" : ""}>60 Hz</option></select></div>
          ${audioFxControl("削减", "reductionDb", p.reductionDb, 1, 36, 1, " dB")}
          ${audioFxControl("谐波", "harmonics", p.harmonics, 1, 8, 1)}
          ${audioFxControl("陷波 Q", "q", p.q, 4, 80, 1)}
        </div><div class="field audio-fx-action"><button class="btn" type="button" data-fx-analyze-hum="${effect.id}">分析 50/60 Hz</button><span class="small">${p.autoAnalyzed ? (p.detectedFrequency ? `已检测到 ${p.detectedFrequency} Hz` : "未检测到可靠工频，自动模式将安全旁路") : "自动模式会在试听、整轨应用或导出前分析"}</span></div>`;
        if (effect.type === "dialogue-separator") return `<div class="audio-fx-grid">
          ${audioFxControl("人声", "voiceDb", p.voiceDb, -12, 12, .5, " dB")}
          ${audioFxControl("背景", "backgroundDb", p.backgroundDb, -30, 6, .5, " dB")}
          ${audioFxControl("环境", "ambienceDb", p.ambienceDb, -30, 6, .5, " dB")}
          ${audioFxControl("对话聚焦", "focus", p.focus, 0, 100, 1, "%", 100)}
        </div><div class="small">使用开放的中置/侧声道对话聚焦；本机安装分离模型后可升级为离线神经分离。</div>`;
        if (effect.type === "de-esser") return `<div class="audio-fx-grid">
          ${audioFxControl("目标频率", "frequency", p.frequency, 0, 100, 1, "%", 100)}
          ${audioFxControl("阈值", "threshold", p.threshold, 0, 100, 1, "%", 100)}
          ${audioFxControl("最大削减", "reduction", p.reduction, 0, 100, 1, "%", 100)}
          <label class="switch"><span>只听齿音</span><input type="checkbox" data-fx-param="listen" ${p.listen ? "checked" : ""}></label>
        </div>`;
        if (effect.type === "expander-gate") return `<div class="audio-fx-grid">
          ${audioFxControl("门限", "thresholdDb", p.thresholdDb, -80, -6, 1, " dB")}
          ${audioFxControl("比例", "ratio", p.ratio, 1, 20, .1, ":1")}
          ${audioFxControl("最大衰减", "rangeDb", p.rangeDb, -60, 0, 1, " dB")}
          ${audioFxControl("起音", "attackMs", p.attackMs, .1, 500, 1, " ms")}
          ${audioFxControl("保持", "holdMs", p.holdMs, 0, 1000, 5, " ms")}
          ${audioFxControl("释放", "releaseMs", p.releaseMs, 1, 3000, 10, " ms")}
        </div>`;
        if (effect.type === "compressor-limiter") return `<div class="audio-fx-grid">
          ${audioFxControl("压缩阈值", "thresholdDb", p.thresholdDb, -60, 0, 1, " dB")}
          ${audioFxControl("比例", "ratio", p.ratio, 1, 20, .1, ":1")}
          ${audioFxControl("起音", "attackMs", p.attackMs, .1, 500, 1, " ms")}
          ${audioFxControl("释放", "releaseMs", p.releaseMs, 10, 3000, 10, " ms")}
          ${audioFxControl("补偿增益", "makeupDb", p.makeupDb, 0, 18, .5, " dB")}
          ${audioFxControl("混合", "mix", p.mix, 0, 100, 1, "%", 100)}
          <label class="switch"><span>启用限幅</span><input type="checkbox" data-fx-param="limiter" ${p.limiter !== false ? "checked" : ""}></label>
          ${audioFxControl("输出上限", "ceilingDb", p.ceilingDb, -6, 0, .1, " dB")}
        </div>`;
        if (effect.type === "parametric-eq") return `<div class="small">每段依次设置类型、频率、增益和 Q 值。</div>${(p.bands || []).map((band, index) => `<div class="audio-fx-eq-band"><input type="checkbox" data-fx-band="${index}" data-fx-band-field="enabled" ${band.enabled !== false ? "checked" : ""} title="启用第 ${index + 1} 段"><select class="select" data-fx-band="${index}" data-fx-band-field="type"><option value="highpass" ${band.type === "highpass" ? "selected" : ""}>HP</option><option value="lowshelf" ${band.type === "lowshelf" ? "selected" : ""}>低架</option><option value="bell" ${band.type === "bell" ? "selected" : ""}>钟形</option><option value="highshelf" ${band.type === "highshelf" ? "selected" : ""}>高架</option><option value="lowpass" ${band.type === "lowpass" ? "selected" : ""}>LP</option></select><input class="input" type="number" min="20" max="20000" step="10" value="${band.frequency}" data-fx-band="${index}" data-fx-band-field="frequency" title="频率 Hz"><div class="row"><input class="input" type="number" min="-18" max="18" step=".5" value="${band.gain}" data-fx-band="${index}" data-fx-band-field="gain" title="增益 dB"><input class="input" type="number" min=".1" max="20" step=".1" value="${band.q}" data-fx-band="${index}" data-fx-band-field="q" title="Q"></div></div>`).join("")}`;
        return "";
      }
      function renderAudioFxRack() {
        const target = currentAudioFxTarget(true);
        document.querySelectorAll("[data-audio-fx-scope]").forEach((button) =>
          button.classList.toggle("active", button.dataset.audioFxScope === state.audioFxScope),
        );
        $("applyAudioFxRack").disabled = state.audioFxScope !== "track" || !state.video;
        $("applyAudioFxRack").textContent = state.audioFxScope === "track" ? "应用音轨效果" : "片段效果随导出应用";
        if (!target) {
          $("audioFxRackList").innerHTML = '<div class="audio-fx-empty">请先选择一个主音频或独立音频片段。</div>';
          $("addAudioFx").disabled = true;
          $("audioFxBypass").disabled = true;
          return;
        }
        $("addAudioFx").disabled = target.rack.length >= 6;
        $("audioFxBypass").disabled = false;
        $("audioFxBypass").textContent = target.bypass ? "恢复全部效果" : "全部旁路";
        $("audioFxRackList").innerHTML = target.rack.length
          ? target.rack.map((effect, index) => `<div class="audio-fx-card ${effect.enabled ? "" : "bypassed"}" data-fx-id="${effect.id}"><div class="audio-fx-head"><input type="checkbox" data-fx-action="toggle" ${effect.enabled ? "checked" : ""}><strong>FX${index + 1} · ${escapeHtml(effect.name)}</strong><button class="btn" type="button" data-fx-action="up" title="上移">↑</button><button class="btn" type="button" data-fx-action="down" title="下移">↓</button><button class="btn" type="button" data-fx-action="copy" title="复制">⧉</button><button class="btn" type="button" data-fx-action="remove" title="删除">×</button></div><div class="audio-fx-body">${audioFxBody(effect)}<div class="row" style="margin-top:7px"><button class="btn" type="button" data-fx-action="reset">重置此效果</button></div></div></div>`).join("")
          : '<div class="audio-fx-empty">没有效果。点击“＋添加”建立第一层处理。</div>';
        installRangeSteppers($("audioFxRackList"));
      }
      function invalidateAudioFxCache(trackChanged = state.audioFxScope !== "clip") {
        // The rendered cache only contains the main track rack. Clip FX stay
        // live before concat, so editing a clip must not discard a valid track cache.
        if (trackChanged && state.denoisedAudio?.includesAudioFx) state.denoisedAudio = null;
        syncPreviewAudio();
        queueAutosave();
      }
      function findAudioFx(id) {
        const target = currentAudioFxTarget(true);
        return { target, effect: target?.rack.find((item) => item.id === id) };
      }
      function audioFxSourceContext(atTimeline = state.currentTime) {
        if (state.audioFxScope === "clip" && state.selected.type === "audioasset") {
          const asset = state.audioAssets.find((item) => item.id === state.selected.id);
          if (!asset?.path) return null;
          const timelineTime = clamp(Number(atTimeline || 0), Number(asset.start || 0), Number(asset.end || asset.start || 0));
          return {
            path: asset.path,
            time: Math.max(0, Number(asset.sourceStart || 0) + timelineTime - Number(asset.start || 0)),
            maxDuration: Math.max(.25, Number(asset.end || timelineTime) - timelineTime),
            external: true,
            asset,
          };
        }
        if (!state.video?.path) return null;
        if (state.audioFxScope === "clip" && state.selected.type === "audio") {
          const clip = mainAudioClips().find((item) => item.id === state.selected.id);
          if (clip) {
            const timelineTime = clamp(Number(atTimeline || 0), Number(clip.start || 0), Number(clip.end || clip.start || 0));
            const timelineDuration = Math.max(.001, Number(clip.end || 0) - Number(clip.start || 0));
            const sourceDuration = Math.max(.001, Number(clip.sourceEnd || 0) - Number(clip.sourceStart || 0));
            return {
              path: state.video.path,
              time: Math.max(0, Number(clip.sourceStart || 0) + (timelineTime - Number(clip.start || 0)) * sourceDuration / timelineDuration),
              maxDuration: Math.max(.25, Number(clip.end || timelineTime) - timelineTime),
              external: false,
              clip,
            };
          }
        }
        return {
          path: state.video.path,
          time: Math.max(0, timelineToSource(Number(atTimeline || 0))),
          maxDuration: 10,
          external: false,
        };
      }
      async function learnSelectedNoise(effectId) {
        const range = state.timelineRange && state.timelineRange.end > state.timelineRange.start
          ? state.timelineRange
          : { start: state.currentTime, end: state.currentTime + 2 };
        const source = audioFxSourceContext(Number(range.start || 0));
        if (!source?.path) return toast("请先导入或选择带声音的片段");
        const { target, effect } = findAudioFx(effectId);
        if (!effect || effect.type !== "noise-reduction") return;
        const duration = Math.min(source.maxDuration, clamp(Number(range.end) - Number(range.start), .25, 10));
        $("audioFxState").textContent = "正在学习选区中的纯噪声…";
        try {
          const profile = await nativeCall("learnAudioFxNoiseProfile", {
            path: source.path,
            time: source.time,
            duration,
          });
          snapshot();
          effect.params.mode = "learn";
          effect.params.learnedBands = profile.bands;
          effect.params.noiseFloorDb = profile.noiseFloorDb;
          effect.params.learnedAt = Number(range.start || 0);
          effect.params.learnedDuration = profile.duration;
          for (const item of target?.rack || [])
            if (item.type === "de-hummer" && item.params.frequency === "auto")
              item.params.detectedFrequency = profile.humFrequency || 0;
          setCurrentAudioFxRack(target.rack);
          invalidateAudioFxCache();
          renderAudioFxRack();
          $("audioFxState").textContent = `噪声学习完成：${profile.duration.toFixed(1)} 秒、噪声底 ${profile.noiseFloorDb} dB${profile.humFrequency ? `、检测到 ${profile.humFrequency} Hz` : ""}。`;
        } catch (error) {
          $("audioFxState").textContent = error.message;
          toast(error.message);
        }
      }
      async function analyzeSelectedAudioFxHum(effectId) {
        const source = audioFxSourceContext(state.currentTime);
        if (!source?.path) return toast("请先导入或选择带声音的片段");
        const { target, effect } = findAudioFx(effectId);
        if (!effect || effect.type !== "de-hummer") return;
        $("audioFxState").textContent = "正在分析 50/60 Hz 工频及谐波…";
        try {
          const profile = await nativeCall("analyzeNoiseProfile", {
            path: source.path, time: source.time, duration: Math.min(10, source.maxDuration),
          });
          snapshot();
          effect.params.detectedFrequency = Number(profile.humFrequency || 0);
          effect.params.autoAnalyzed = true;
          setCurrentAudioFxRack(target.rack);
          invalidateAudioFxCache();
          renderAudioFxRack();
          $("audioFxState").textContent = profile.humFrequency
            ? `检测到 ${profile.humFrequency} Hz 工频嗡声，自动模式已锁定。`
            : "没有可靠检测到 50/60 Hz 工频；自动模式不会误伤人声，可手动指定频率。";
        } catch (error) {
          $("audioFxState").textContent = error.message;
          toast(error.message);
        }
      }
      async function ensureAudioFxHumAnalysis(includeAllClips = false) {
        const groups = [];
        if (state.video?.path) {
          groups.push({ owner: state, key: "audioFxRack", path: state.video.path, time: 0 });
          if (includeAllClips) {
            for (const settings of Object.values(state.mainAudioClipSettings || {}))
              groups.push({ owner: settings, key: "fxRack", path: state.video.path, time: 0 });
          }
        }
        if (includeAllClips) {
          for (const asset of state.audioAssets || [])
            if (asset.path) groups.push({ owner: asset, key: "fxRack", path: asset.path, time: Number(asset.sourceStart || 0) });
        }
        const profileBySource = new Map();
        let changed = false;
        for (const group of groups) {
          const rack = normalizeAudioFxRack(group.owner[group.key]);
          group.owner[group.key] = rack;
          const pending = rack.filter((effect) =>
            effect.enabled && effect.type === "de-hummer" &&
            String(effect.params?.frequency || "auto") === "auto" &&
            !effect.params?.autoAnalyzed &&
            ![50, 60].includes(Number(effect.params?.detectedFrequency || 0)),
          );
          if (!pending.length) continue;
          let profile = profileBySource.get(group.path);
          if (!profile) {
            try {
              profile = await nativeCall("analyzeNoiseProfile", {
                path: group.path, time: group.time, duration: 8,
              });
            } catch (error) {
              console.warn("自动工频分析失败，保持安全旁路", error);
              profile = { humFrequency: 0 };
            }
            profileBySource.set(group.path, profile);
          }
          for (const effect of pending) {
            effect.params.detectedFrequency = Number(profile.humFrequency || 0);
            effect.params.autoAnalyzed = true;
            changed = true;
          }
        }
        if (changed) {
          if (state.denoisedAudio?.includesAudioFx) state.denoisedAudio = null;
          queueAutosave();
          renderAudioFxRack();
        }
        return changed;
      }
      function currentClipFxRackForPreview() {
        const clip = mainAudioClips().find((item) => state.currentTime >= item.start && state.currentTime < item.end);
        return normalizeAudioFxRack(mainAudioSettings(clip, false)?.fxRack || []);
      }
      function audioFxPreviewSettings(source = audioFxSourceContext(state.currentTime)) {
        const selectedTarget = state.audioFxScope === "clip" ? currentAudioFxTarget(false) : null;
        return {
          quickDenoise: { ...state.denoise, strength: state.denoiseEnabled ? state.denoise.strength : 0 },
          clipFxRack: selectedTarget?.rack || currentClipFxRackForPreview(),
          clipFxBypass: selectedTarget ? !!selectedTarget.bypass : !!mainAudioSettings(mainAudioClips().find((item) => state.currentTime >= item.start && state.currentTime < item.end), false)?.fxBypass,
          trackFxRack: source?.external ? [] : normalizeAudioFxRack(state.audioFxRack),
          trackFxBypass: source?.external || !!state.audioFxBypass,
          detectedHumFrequency: Number(state.denoise?.detectedHumFrequency || 0),
        };
      }
      async function auditionAudioFx() {
        const source = audioFxSourceContext(state.currentTime);
        if (!source?.path) return toast("请先导入或选择带声音的片段");
        const button = $("audioFxAudition");
        if (button.dataset.listening === "processed") {
          $("denoiseCompare").pause();
          $("denoiseCompare").style.display = "none";
          $("video").muted = false;
          if (!source.external) {
            $("video").currentTime = source.time;
            $("video").play().catch(() => {});
          }
          button.dataset.listening = "original";
          button.textContent = "试听处理后";
          return;
        }
        button.disabled = true;
        button.textContent = "正在生成…";
        try {
          const result = await nativeCall("audioFxPreview", {
            path: source.path, time: source.time, settings: audioFxPreviewSettings(source),
          });
          const compare = $("denoiseCompare");
          compare.src = result.url;
          compare.style.display = "block";
          compare.currentTime = Math.max(0, Number(result.targetOffset || 0));
          $("video").muted = true;
          compare.onended = () => { button.dataset.listening = "original"; button.textContent = "试听处理后"; syncPreviewAudio(); };
          await compare.play();
          button.dataset.listening = "processed";
          button.textContent = "切换到原声";
        } catch (error) {
          toast(error.message);
          button.textContent = "A/B 试听";
        } finally { button.disabled = false; }
      }
      async function applyAudioFxTrack() {
        if (!state.video?.path || state.audioFxScope !== "track") return;
        const button = $("applyAudioFxRack");
        button.disabled = true;
        button.textContent = "正在处理整轨…";
        $("audioFxState").textContent = "正在按当前顺序生成高级音轨缓存…";
        try {
          await ensureAudioFxHumAnalysis(false);
          const settings = audioFxPreviewSettings();
          settings.clipFxRack = [];
          settings.clipFxBypass = true;
          const media = await nativeCall("applyAudioFxTrack", {
            projectId: state.projectId, path: state.video.path, settings,
          });
          state.denoisedAudio = {
            ...media, sourcePath: state.video.path, mode: "audio-fx-rack",
            includesAudioFx: true, fxSignature: audioFxSignature(),
            configSignature: denoiseSettingsSignature(),
          };
          syncPreviewAudio();
          queueAutosave();
          syncAudioControls();
          $("audioFxState").textContent = "高级音轨缓存已应用；时间线播放和导出将复用该缓存。";
          toast("高级音频修复已应用到整条音轨");
        } catch (error) {
          $("audioFxState").textContent = error.message;
          toast(error.message);
        } finally { button.disabled = false; button.textContent = "应用音轨效果"; }
      }
      