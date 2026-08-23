function renderIssues() {
        const box = $("issueList");
        const cutCount = state.issues.filter((item) =>
            ["extra", "repeat", "mismatch"].includes(item.type),
          ).length,
          missingCount = state.issues.filter((item) => item.type === "missing").length,
          replaceCount = 0;
        box.innerHTML = state.issues.length
          ? `<div class="status warn">共 ${state.issues.length} 处：${cutCount} 个红色段点击试听，Alt+点击用识别口播替换错误文稿，Ctrl+点击保留不删除，Shift+点击接受并删除${missingCount ? `，${missingCount} 处文案没有读出，已标记需补录` : ""}。主字幕只显示已和音频可靠匹配的正确文案。</div>`
          : '<div class="small">匹配后：红色段点击试听，Alt+点击替换为识别口播，Ctrl+点击保留，Shift+点击删除。</div>';
      }
      let captionInspectorKey = "";
      function editableCaptionTokens(text) {
        const raw = String(text || "").match(/\d+:\d+(?:-\d+)?|[\$¥€£]\d+(?:\.\d+)?|\d+(?:\.\d+)?%|\d+(?:\.\d+)?(?:kg|km|m|cm|mm|px|ms|s)|[A-Za-z]\.(?:[A-Za-z]\.)+|[\p{L}\p{N}]+(?:[’'\-][\p{L}\p{N}]+)*|[^\s\p{L}\p{N}]/gu) || [];
        const words = [];
        let prefix = "";
        let inDoubleQuote = false;
        let inSingleQuote = false;
        const CLOSING_OR_PAUSE_PUNCT = /^["”’」』》〉）】〕〗)\]}。，、；：！？…—～.,!?:;-]$/u;
        for (const token of raw) {
          if (/^[\p{L}\p{N}\$¥€£]/u.test(token)) {
            words.push(`${prefix}${token}`);
            prefix = "";
          } else if (token === '"') {
            if (inDoubleQuote) {
              if (words.length) words[words.length - 1] += token;
              else prefix += token;
              inDoubleQuote = false;
            } else {
              prefix += token;
              inDoubleQuote = true;
            }
          } else if (token === "'") {
            if (inSingleQuote) {
              if (words.length) words[words.length - 1] += token;
              else prefix += token;
              inSingleQuote = false;
            } else {
              prefix += token;
              inSingleQuote = true;
            }
          } else if (/^[“‘「『《〈（【〔〖(\[{]$/u.test(token)) {
            prefix += token;
            if (token === "“") inDoubleQuote = true;
            if (token === "‘") inSingleQuote = true;
          } else if (CLOSING_OR_PAUSE_PUNCT.test(token)) {
            if (token === "”") inDoubleQuote = false;
            if (token === "’") inSingleQuote = false;
            if (words.length) words[words.length - 1] += token;
            else prefix += token;
          } else if (words.length) {
            words[words.length - 1] += token;
          } else {
            prefix += token;
          }
        }
        if (prefix && words.length) {
          words[words.length - 1] += prefix;
        }
        return words;
      }
      function timedCaptionWords(text, caption) {
        const tokens = editableCaptionTokens(text),
          start = Number(caption.start || 0),
          end = Math.max(start + .04, Number(caption.end || start + .04));
        return tokens.map((display, index) => ({
          display,
          start: start + (end - start) * index / Math.max(1, tokens.length),
          end: start + (end - start) * (index + 1) / Math.max(1, tokens.length),
          matchType: "match",
        }));
      }
      function auxiliaryCaptionState(caption) {
        const text = String(caption?.auxText || "").trim();
        if (!text) return { key: "missing", label: "待翻译" };
        const stale =
          String(caption.auxSourceText || "") !== String(caption.text || "") ||
          String(caption.auxLanguage || "zh-Hans") !== String(state.auxSubtitles.language || "zh-Hans");
        if (caption.auxLocked && stale) return { key: "locked", label: "人工已锁定 · 英文有变化" };
        if (caption.auxLocked) return { key: "locked", label: "人工已锁定" };
        if (stale) return { key: "stale", label: "英文有变化 · 待更新" };
        return { key: "current", label: "已同步" };
      }
      function syncAuxSubtitleControls() {
        state.auxSubtitles = { ...defaultAuxSubtitleSettings(), ...(state.auxSubtitles || {}) };
        if ($("auxSubtitleLanguage")) $("auxSubtitleLanguage").value = state.auxSubtitles.language;
        if ($("auxSubtitleEditorVisible")) $("auxSubtitleEditorVisible").checked = state.auxSubtitles.editorVisible !== false;
        const counts = { missing: 0, stale: 0, locked: 0, current: 0 };
        for (const caption of state.captions || []) counts[auxiliaryCaptionState(caption).key] += 1;
        if ($("auxSubtitleStatus")) {
          $("auxSubtitleStatus").textContent = state.captions.length
            ? `已同步 ${counts.current} · 待生成/更新 ${counts.missing + counts.stale} · 人工锁定 ${counts.locked}`
            : "匹配英文文案后可生成；人工修改的中文会锁定保留。";
        }
      }
      async function generateAuxiliarySubtitles(ids = null) {
        if (!state.captions.length) return toast("请先匹配英文文案");
        const requested = ids ? new Set(ids.map(String)) : null;
        const targets = state.captions.filter((caption) => {
          if (requested) return requested.has(String(caption.id));
          const status = auxiliaryCaptionState(caption).key;
          return !caption.auxLocked && (status === "missing" || status === "stale");
        });
        if (!targets.length) return toast(requested ? "没有可重译的字幕" : "中文辅助字幕已经是最新；人工锁定内容不会被覆盖");
        const button = $("generateAuxSubtitles");
        if (button) {
          button.disabled = true;
          button.textContent = `正在翻译 ${targets.length} 句…`;
        }
        try {
          const result = await nativeCall("translateAuxiliaryCaptions", {
            targetLanguage: state.auxSubtitles.language,
            captions: targets.map((caption) => ({ id: caption.id, text: caption.text })),
          });
          snapshot();
          const translated = new Map((result.translations || []).map((item) => [String(item.id), item.text]));
          let applied = 0;
          for (const caption of targets) {
            const text = String(translated.get(String(caption.id)) || "").trim();
            if (!text) continue;
            caption.auxText = text;
            caption.auxSourceText = caption.text;
            caption.auxLanguage = state.auxSubtitles.language;
            caption.auxLocked = false;
            applied += 1;
          }
          captionInspectorKey = "";
          renderCaptionInspector(true);
          syncAuxSubtitleControls();
          renderPreviewObjects(true);
          queueAutosave();
          toast(applied === targets.length ? `已生成 ${applied} 句中文辅助字幕` : `已生成 ${applied}/${targets.length} 句，未返回的句子可再次更新`);
        } catch (error) {
          toast(error.message);
          if (/纠正设置/.test(error.message)) openReviewSettings();
        } finally {
          if (button) {
            button.disabled = false;
            button.textContent = "生成／更新中文辅助字幕";
          }
        }
      }
      function renderCaptionInspector(force = false) {
        const key = JSON.stringify(state.captions.map((caption) => [
          caption.id, caption.start, caption.end, caption.text, caption.auxText,
          caption.auxSourceText, caption.auxLanguage, caption.auxLocked,
        ]));
        if (!force && key === captionInspectorKey) {
          focusCaptionInspector(state.selected.type === "caption" ? state.selected.id : "", false);
          return;
        }
        captionInspectorKey = key;
        $("captionInspectorList").innerHTML = state.captions.length
          ? state.captions.map((caption, index) => {
              const auxState = auxiliaryCaptionState(caption);
              return `<div class="caption-inspector-row ${state.selected.type === "caption" && state.selected.id === caption.id ? "selected" : ""}" data-caption-row="${escapeHtml(caption.id)}"><input type="checkbox" data-caption-check="${escapeHtml(caption.id)}" checked><span class="small">${formatTime(caption.start, false)}</span><div class="caption-inspector-copy"><textarea data-caption-edit="${escapeHtml(caption.id)}" aria-label="第 ${index + 1} 段英文主字幕">${escapeHtml(caption.text)}</textarea><div class="caption-aux-head"><span class="caption-aux-state ${auxState.key}">${escapeHtml(auxState.label)}</span><button type="button" class="btn small" data-caption-aux-retranslate="${escapeHtml(caption.id)}">重译</button></div><textarea class="caption-aux-edit" data-caption-aux-edit="${escapeHtml(caption.id)}" aria-label="第 ${index + 1} 段中文辅助字幕" placeholder="中文辅助翻译（不影响英文）">${escapeHtml(caption.auxText || "")}</textarea></div></div>`;
            }).join("")
          : '<div class="small">匹配文案后，这里会显示已经断行的全部字幕。</div>';
      }
      function focusCaptionInspector(id, scroll = true) {
        const list = $("captionInspectorList");
        if (!list) return;
        list.querySelectorAll("[data-caption-row]").forEach((row) =>
          row.classList.toggle("selected", !!id && row.dataset.captionRow === id),
        );
        if (!id || !scroll) return;
        const row = [...list.querySelectorAll("[data-caption-row]")].find((item) => item.dataset.captionRow === id);
        if (row) requestAnimationFrame(() => row.scrollIntoView({ block: "nearest", behavior: "auto" }));
      }
      function replacementBoundary(tokens, ideal, minimum) {
        let best = clamp(Math.round(ideal), minimum + 1, tokens.length - 1),
          score = Infinity;
        for (let index = Math.max(minimum + 1, best - 3); index <= Math.min(tokens.length - 1, best + 3); index += 1) {
          const punctuation = /[.!?…\u3002\uff01\uff1f]["'”’」』》〉）】〕〗)]*$/u.test(tokens[index - 1] || "") ? -8
            : /[,;:—–-，、；：]["'”’」』》〉）】〕〗)]*$/u.test(tokens[index - 1] || "") ? -3 : 0;
          const orphan = /^(?:and|but|or|so|because|for|yet)$/i.test((tokens[index] || "").replace(/[^\p{L}]/gu, "")) ? 2 : 0;
          const candidate = Math.abs(index - ideal) + punctuation + orphan;
          if (candidate < score) { score = candidate; best = index; }
        }
        return best;
      }
      function replaceCaptionsFromManuscript() {
        if (!state.captions.length) return toast("请先匹配生成字幕");
        const tokens = editableCaptionTokens($("scriptText").value);
        if (!tokens.length) return toast("请先粘贴正确文案");
        const selectedIds = new Set(
          [...$("captionInspectorList").querySelectorAll("[data-caption-check]:checked")]
            .map((input) => input.dataset.captionCheck),
        );
        if (!selectedIds.size) return toast("请先勾选需要替换的字幕");
        snapshot();
        const hasAlignedManuscriptWords = state.captions.some((caption) =>
          (caption.words || []).some((word) => String(word.expectedDisplay || "").trim()),
        );
        if (hasAlignedManuscriptWords) {
          for (const caption of state.captions) {
            if (!selectedIds.has(caption.id) || !caption.words?.length) continue;
            caption.words = caption.words.map((word) => ({
              ...word,
              display: String(word.expectedDisplay || word.display || "").trim(),
              matchType: "match",
              issueType: "",
            })).filter((word) => word.display);
            caption.text = joinCaptionWords(caption.words);
            if (caption.words.length) {
              caption.start = Number(caption.words[0].start || caption.start);
              caption.end = Math.max(caption.start + .04, Number(caption.words.at(-1).end || caption.end));
            }
          }
          captionInspectorKey = "";
          renderAll();
          renderCaptionInspector(true);
          toast("已按当前剪辑后的断行替换为正确文案，删除的词句不会恢复");
          return;
        }
        const existingTotal = state.captions.reduce((sum, caption) =>
          sum + Math.max(1, caption.words?.length || editableCaptionTokens(caption.text).length), 0);
        let cursor = 0, usedWeight = 0;
        state.captions.forEach((caption, index) => {
          const weight = Math.max(1, caption.words?.length || editableCaptionTokens(caption.text).length);
          usedWeight += weight;
          const endIndex = index === state.captions.length - 1
            ? tokens.length
            : replacementBoundary(tokens, tokens.length * usedWeight / existingTotal, cursor);
          const text = joinCaptionWords(tokens.slice(cursor, Math.max(cursor + 1, endIndex)));
          if (selectedIds.has(caption.id)) {
            caption.text = text;
            caption.words = timedCaptionWords(text, caption);
          }
          cursor = endIndex;
        });
        captionInspectorKey = "";
        renderAll();
        renderCaptionInspector(true);
        toast("已按当前断行替换为正确文案，全部时间戳保持不变");
      }
      function allCaptionPresets() {
        return [...presets, ...customPresets];
      }
      function presetPreviewColor(style, index) {
        const value = String(style?.color || "#ffffff").trim();
        if (/^(?:black|#0{3}|#0{6}|rgb\(\s*0\s*,\s*0\s*,\s*0\s*\))$/i.test(value))
          return ["#ffd21f", "#58e391", "#ff963d", "#50a8ff", "#35dce0"][
            index % 5
          ];
        const match = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
        if (!match) return value;
        const hex = match[1].length === 3
          ? match[1].split("").map((part) => part + part).join("")
          : match[1];
        const channels = [0, 2, 4].map((offset) =>
          parseInt(hex.slice(offset, offset + 2), 16) / 255,
        );
        const luminance = channels
          .map((channel) =>
            channel <= 0.03928
              ? channel / 12.92
              : Math.pow((channel + 0.055) / 1.055, 2.4),
          )
          .reduce(
            (total, channel, channelIndex) =>
              total + channel * [0.2126, 0.7152, 0.0722][channelIndex],
            0,
          );
        const panelLuminance = 0.021;
        const contrast =
          (Math.max(luminance, panelLuminance) + 0.05) /
          (Math.min(luminance, panelLuminance) + 0.05);
        return contrast >= 3
          ? value
          : ["#ffd21f", "#58e391", "#ff963d", "#50a8ff", "#35dce0"][
              index % 5
            ];
      }
      function presetPreviewStroke(style, index) {
        if (Number(style?.stroke || 0) <= 0) return "transparent";
        const value = String(style?.strokeColor || "").trim();
        if (
          !value ||
          /^(?:black|#0{3}|#0{6}|rgb\(\s*0\s*,\s*0\s*,\s*0\s*\))$/i.test(value)
        )
          return ["#ffffff", "#ffe15a", "#7eeaff", "#b8ffcf"][index % 4];
        const match = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
        if (!match) return value;
        const hex = match[1].length === 3
          ? match[1].split("").map((part) => part + part).join("")
          : match[1];
        const brightness =
          parseInt(hex.slice(0, 2), 16) * 0.2126 +
          parseInt(hex.slice(2, 4), 16) * 0.7152 +
          parseInt(hex.slice(4, 6), 16) * 0.0722;
        return brightness < 82
          ? ["#ffffff", "#ffe15a", "#7eeaff", "#b8ffcf"][index % 4]
          : value;
      }
      function renderPresetCard(p, i, isCustom = false) {
        const bg = p.style.backgroundEnabled ? (p.style.background || "#131922") : "transparent";
        const strokePx = Math.min(3, Math.max(0, Number(p.style.stroke || 0)));
        const strokeCss = strokePx > 0 ? `-webkit-text-stroke:${strokePx}px ${p.style.strokeColor || "#000"};paint-order:stroke fill;` : "";
        const shadowCss = Number(p.style.shadow || 0) > 0 ? `filter:drop-shadow(0 2px 4px rgba(0,0,0,0.85));` : "";
        const customDel = isCustom
          ? `<button type="button" class="preset-del-btn" data-del-preset="${i - presets.length}" title="删除自定义模板">✕</button>`
          : "";
        return `<button class="preset" data-preset="${i}" title="${escapeHtml(p.name)}">
          ${customDel}
          <span class="captionobject anim-enter" data-animation="${escapeHtml(p.style.animation || "fade")}" style="--active:${p.style.highlight || "#ffd21f"};font-family:'${p.style.fontFamily || "Helvetica"}',sans-serif;font-weight:${p.style.fontWeight || 700};color:${presetPreviewColor(p.style, i)};-webkit-text-stroke:${Math.min(3, Math.max(0, Number(p.style.stroke || 0)) * 2)}px ${presetPreviewStroke(p.style, i)};paint-order:stroke fill;${shadowCss}background:${bg};padding:3px 6px;border-radius:${Math.min(16, p.style.radius || 0)}px">
            <span class="word">Amazing</span><span class="word active">Story</span>
          </span>
          <span class="small ellipsis">${escapeHtml(p.name)}</span>
        </button>`;
      }
      function renderPresets() {
        const systemHtml = presets.map((p, i) => renderPresetCard(p, i, false)).join("");
        const customHtml = customPresets.map((p, i) => renderPresetCard(p, presets.length + i, true)).join("");
        $("presetList").innerHTML = `
          <div class="preset-group-title">🌟 主流爆款预设</div>
          <div class="preset-grid">${systemHtml}</div>
          <div class="preset-group-title" style="margin-top:12px">🎨 我的自定义模板 (${customPresets.length})</div>
          <div class="preset-grid">${customHtml || '<div class="small" style="grid-column:1/-1;color:var(--muted);padding:8px 4px">暂无自定义模板，可在右侧调整属性后点击下方按钮保存。</div>'}</div>
        `;
      }
      async function loadCustomPresets() {
        try {
          const stored = localStorage.getItem("quickcut_custom_caption_presets");
          if (stored) {
            customPresets = JSON.parse(stored) || [];
          } else {
            customPresets = (await nativeCall("customCaptionPresets")) || [];
          }
        } catch (error) {
          console.warn(error);
        }
        renderPresets();
      }
      function selectedAnimationObject() {
        return ["text", "image"].includes(state.selected.type)
          ? currentObject()
          : null;
      }
      function renderAnimationPanel() {
        const object = selectedAnimationObject(),
          type = state.selected.type === "image" ? "image" : "text",
          list = type === "text" ? textAnimations : imageAnimations,
          selectedId = object?.[`${animationMode}Animation`] || "";
        $("animationHint").textContent = object
          ? `${type === "text" ? "文字" : "图片"}·${animationMode === "enter" ? "入场" : "出场"}动画；移入卡片预览，点击套用。`
          : "请先在时间线或预览窗口选中一段文字或图片。";
        $("animationDuration").disabled = !object;
        const duration = object
          ? Number(object[`${animationMode}Duration`] || 0.45)
          : 0.45;
        $("animationDuration").value = Math.round(duration * 100);
        $("animationDurationOut").textContent = `${duration.toFixed(2)}秒`;
        $("animationGrid").innerHTML = list
          .map(
            (entry) =>
              `<button class="animation-card ${entry.id === selectedId ? "active" : ""}" data-animation-id="${entry.id}" data-motion="${entry.motion}" title="${entry.name}"><span class="animation-demo">${type === "text" ? "Amazing Story" : "图片"}</span><span class="small ellipsis">${entry.name}</span></button>`,
          )
          .join("");
        document.querySelectorAll("[data-animation-mode]").forEach((button) =>
          button.classList.toggle("active", button.dataset.animationMode === animationMode),
        );
      }
      function updateInspector() {
        const obj = currentObject() || state.videoTransform,
          s = currentStyle(),
          labels = {
            video: "视频属性",
            videolayer: "叠加视频属性",
            audio: "主音频属性",
            audioasset: "音频素材属性",
            image: "图片属性",
            text: "标题文字",
            caption: "字幕属性",
            review: "差异复核",
          };
        const selectedVisualCount = (state.selectedItems || []).filter((item) =>
          ["video", "videolayer", "image"].includes(item.type),
        ).length;
        $("selectionTitle").textContent = selectedVisualCount > 1
          ? `已选 ${selectedVisualCount} 个画面片段`
          : labels[state.selected.type] || "素材属性";
        if ($("multiTransformHint"))
          $("multiTransformHint").style.display = selectedVisualCount > 1 ? "block" : "none";
        $("objectScale").value = Math.round((obj.scale || 1) * 100);
        $("scaleOut").textContent = `${$("objectScale").value}%`;
        $("objectX").value = Math.round(obj.x || 0);
        $("objectY").value = Math.round(obj.y || 0);
        const visual = ["video", "videolayer", "image", "text"].includes(state.selected.type);
        $("visualProperties").style.display = visual ? "block" : "none";
        $("objectRotation").value = Math.round(Number(obj.rotation || 0));
        $("rotationOut").textContent = `${$("objectRotation").value}°`;
        $("objectOpacity").value = Math.round(Number(obj.opacity ?? 1) * 100);
        $("opacityOut").textContent = `${$("objectOpacity").value}%`;
        $("objectBlendMode").value = obj.blendMode || "normal";
        if ($("cropTop")) {
          $("cropTop").value = Math.round(Number(obj.cropTop || 0));
          $("cropTopOut").textContent = `${$("cropTop").value}%`;
          $("cropBottom").value = Math.round(Number(obj.cropBottom || 0));
          $("cropBottomOut").textContent = `${$("cropBottom").value}%`;
          $("cropLeft").value = Math.round(Number(obj.cropLeft || 0));
          $("cropLeftOut").textContent = `${$("cropLeft").value}%`;
          $("cropRight").value = Math.round(Number(obj.cropRight || 0));
          $("cropRightOut").textContent = `${$("cropRight").value}%`;
        }
        $("textProperties").style.display = ["text", "caption"].includes(
          state.selected.type,
        )
          ? "block"
          : "none";
        if (["text", "caption"].includes(state.selected.type)) {
          $("objectText").value =
            state.selected.type === "text"
              ? obj.text
              : currentTimelineObject()?.text || "";
          $("fontSize").value = s.fontSize || 54;
          $("fontWeight").value = s.fontWeight || 700;
          $("fontBoldToggle").classList.toggle("active", Number(s.fontWeight || 700) >= 700);
          $("fontItalicToggle").classList.toggle("active", !!s.fontItalic);
          $("fontUnderlineToggle").classList.toggle("active", !!s.fontUnderline);
          document.querySelectorAll("[data-text-case]").forEach((button) =>
            button.classList.toggle("active", button.dataset.textCase === (s.textCase || "none")),
          );
          syncFontFamilySelection(s);
          $("letterSpacing").value = Number(s.letterSpacing || 0);
          $("letterSpacingOut").textContent = `${Number(s.letterSpacing || 0)}px`;
          $("wordSpacing").value = Number(s.wordSpacing || 0);
          $("wordSpacingOut").textContent = `${Number(s.wordSpacing || 0)}px`;
          $("lineHeight").value = Math.round(Number(s.lineHeight || 1.15) * 100);
          $("lineHeightOut").textContent = `${$("lineHeight").value}%`;
          $("fontColor").value = s.color || "#ffffff";
          $("highlightColor").value = s.highlight || "#ffd21f";
          $("highlightEnabled").checked = s.highlightEnabled !== false;
          $("strokeColor").value = s.strokeColor || "#000000";
          $("stroke").value = s.stroke || 0;
          $("strokeOut").textContent = s.stroke || 0;
          $("shadowColor").value = s.shadowColor || "#000000";
          $("shadowStrength").value = Number(s.shadow ?? 0);
          $("shadowStrengthOut").textContent = Number(s.shadow ?? 0).toFixed(1);
          $("shadowOpacity").value = Math.round(Number(s.shadowOpacity ?? 0.8) * 100);
          $("shadowOpacityOut").textContent = `${$("shadowOpacity").value}%`;
          $("shadowBlur").value = Number(s.shadowBlur ?? s.shadow ?? 0);
          $("shadowBlurOut").textContent = $("shadowBlur").value;
          $("shadowDistance").value = Number(s.shadowDistance ?? s.shadow ?? 0);
          $("shadowDistanceOut").textContent = $("shadowDistance").value;
          $("shadowAngle").value = Number(s.shadowAngle ?? 45);
          $("shadowAngleOut").textContent = `${$("shadowAngle").value}°`;
          $("glowColor").value = s.glowColor || s.color || "#ffffff";
          $("glow").value = s.glow || 0;
          $("glowOut").textContent = s.glow || 0;
          $("backgroundEnabled").checked = !!s.backgroundEnabled;
          if ($("backgroundFitText")) $("backgroundFitText").checked = s.backgroundFitText !== false;
          $("backgroundColor").value = s.background || "#000000";
          $("backgroundOpacity").value = Math.round(
            (s.backgroundOpacity ?? 0.7) * 100,
          );
          $("backgroundOpacityOut").textContent = `${$("backgroundOpacity").value}%`;
          $("backgroundWidth").value = Number(s.backgroundWidth ?? s.padding ?? 14);
          $("backgroundWidthOut").textContent = $("backgroundWidth").value;
          $("backgroundHeight").value = Number(s.backgroundHeight ?? s.padding ?? 14);
          $("backgroundHeightOut").textContent = $("backgroundHeight").value;
          $("backgroundX").value = Number(s.backgroundX || 0);
          $("backgroundXOut").textContent = $("backgroundX").value;
          $("backgroundY").value = Number(s.backgroundY || 0);
          $("backgroundYOut").textContent = $("backgroundY").value;
          $("backgroundRadius").value = s.radius || 0;
          $("backgroundRadiusOut").textContent = $("backgroundRadius").value;
          document.querySelectorAll("[data-text-align]").forEach((button) =>
            button.classList.toggle("active", button.dataset.textAlign === s.textAlign),
          );
          document.querySelectorAll("[data-vertical-align]").forEach((button) =>
            button.classList.toggle("active", button.dataset.verticalAlign === s.verticalAlign),
          );
          document.querySelectorAll("[data-background-mode]").forEach((button) =>
            button.classList.toggle("active", button.dataset.backgroundMode === s.backgroundMode),
          );
        }
        renderAnimationPanel();
      }
      