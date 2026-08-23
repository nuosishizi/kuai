function captionTextLayout() {
        return window.QuickCutTextLayout || {};
      }
      function captionWordsOf(caption) {
        if (!caption) return [];
        if (Array.isArray(caption.words) && caption.words.length) return caption.words;
        const parts = String(caption.text || "")
          .split(/\s+/)
          .filter(Boolean);
        const span = Math.max(0.04, Number(caption.end || 0) - Number(caption.start || 0));
        return parts.map((display, index, list) => ({
          display,
          start: Number(caption.start || 0) + (span * index) / list.length,
          end: Number(caption.start || 0) + (span * (index + 1)) / list.length,
        }));
      }
      function captionFontString(style, fontSize) {
        const italic = style?.fontItalic ? "italic " : "";
        const weight = Number(style?.fontWeight || 700);
        const family = String(style?.fontFamily || "Helvetica").replace(/'/g, "");
        return `${italic}${weight} ${Math.max(8, Number(fontSize || 54))}px "${family}", sans-serif`;
      }
      let captionMeasureContext = null;
      function captionMeasureCtx(style, fontSize) {
        if (!captionMeasureContext) {
          captionMeasureContext = document.createElement("canvas").getContext("2d");
        }
        captionMeasureContext.font = captionFontString(style, fontSize);
        if ("letterSpacing" in captionMeasureContext) {
          captionMeasureContext.letterSpacing = `${Number(style?.letterSpacing || 0)}px`;
        }
        return captionMeasureContext;
      }
      function measureCaptionWord(text, style, fontSize) {
        const ctx = captionMeasureCtx(style, fontSize);
        const display = String(text || "");
        const width = ctx.measureText(display).width;
        const letter = Number(style?.letterSpacing || 0);
        if (!("letterSpacing" in ctx) && letter && display.length > 1) {
          return Math.max(1, width + letter * (display.length - 1));
        }
        return Math.max(1, width);
      }
      function captionCanvasGap(style, fontSize) {
        const space = measureCaptionWord(" ", { ...style, letterSpacing: 0 }, fontSize);
        return Math.max(0, space + fontSize * 0.12 + Number(style?.wordSpacing || 0));
      }
      function layoutCaptionForCanvas(caption, style, boxWidth, scale = 1) {
        const api = captionTextLayout();
        const fontSize = Math.max(8, Number(style.fontSize || 54) * scale);
        const words = captionWordsOf(caption);
        if (typeof api.layoutCaptionPaint === "function") {
          return api.layoutCaptionPaint({
            words,
            style,
            boxWidth,
            scale,
            lineMode: state.captionLines,
            measure: (text) => measureCaptionWord(text, style, fontSize),
            gap: captionCanvasGap(style, fontSize),
          });
        }
        return { lines: [], boxWidth: 0, boxHeight: 0, fontSize, padX: 0, padY: 0, radius: 0 };
      }
      function fillCaptionRoundRect(ctx, x, y, width, height, radius) {
        const next = Math.max(0, Math.min(Number(radius || 0), width / 2, height / 2));
        ctx.beginPath();
        if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, width, height, next);
        else ctx.rect(x, y, width, height);
        ctx.fill();
      }
      function applyCaptionCanvasShadow(ctx, style, scale = 1) {
        const strength = clamp(Number(style.shadow ?? 0), 0, 10);
        const opacity = clamp(Number(style.shadowOpacity ?? 0.8), 0, 1);
        if (strength < 0.001 || opacity < 0.001) {
          ctx.shadowColor = "transparent";
          ctx.shadowBlur = 0;
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = 0;
          return;
        }
        const angle = (Number(style.shadowAngle ?? 45) * Math.PI) / 180;
        const distance = Number(style.shadowDistance ?? 0) * scale;
        ctx.shadowOffsetX = Math.cos(angle) * distance;
        ctx.shadowOffsetY = Math.sin(angle) * distance;
        ctx.shadowBlur = Math.max(
          0.1,
          Number(style.shadowBlur ?? 0) * scale * (0.55 + strength * 0.07),
        );
        ctx.shadowColor = hexAlpha(
          style.shadowColor || "#000000",
          opacity * (0.18 + 0.82 * (strength / 10)),
        );
      }
      function paintCaptionToContext(ctx, layout, style, time, scale = 1) {
        if (!ctx || !layout) return;
        const highlightOn = style.highlightEnabled !== false;
        const fill = style.color || "#ffffff";
        const active = style.highlight || style.highlightColor || "#ffd21f";
        const strokeColor = style.strokeColor || "#000000";
        const strokeWidth = Math.max(0, Number(style.stroke || 0)) * scale * 2;
        const animation = String(style.animation || "fade");
        const shiftX = layout.backgroundEnabled ? Number(style.backgroundX || 0) * scale : 0;
        const shiftY = layout.backgroundEnabled ? Number(style.backgroundY || 0) * scale : 0;
        ctx.save();
        ctx.translate(shiftX, shiftY);
        if (layout.backgroundEnabled) {
          ctx.fillStyle = hexAlpha(style.background || "#000000", style.backgroundOpacity ?? 0.7);
          if (layout.backgroundMode === "line") {
            for (const line of layout.lines) {
              fillCaptionRoundRect(
                ctx,
                line.x - layout.padX,
                line.y,
                line.width + layout.padX * 2,
                layout.lineHeight,
                layout.radius,
              );
            }
          } else {
            fillCaptionRoundRect(ctx, 0, 0, layout.boxWidth, layout.boxHeight, layout.radius);
          }
        }
        ctx.font = captionFontString(style, layout.fontSize);
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
        ctx.lineJoin = "round";
        ctx.miterLimit = 2;
        if ("letterSpacing" in ctx) {
          ctx.letterSpacing = `${Number(style.letterSpacing || 0) * scale}px`;
        }
        const sample = captionMeasureCtx(style, layout.fontSize).measureText("Hg");
        const ascent = Number(sample.actualBoundingBoxAscent || layout.fontSize * 0.8);
        const baseline = ascent + Math.max(0, (layout.lineHeight - layout.fontSize) / 2);
        for (const line of layout.lines) {
          for (const word of line.words) {
            const status =
              Number(time) >= Number(word.end)
                ? "past"
                : Number(time) >= Number(word.start)
                  ? "active"
                  : "";
            const color = highlightOn && status === "active" ? active : fill;
            if (animation === "word-pill" && status === "active") {
              ctx.save();
              ctx.shadowColor = "transparent";
              ctx.fillStyle = active;
              fillCaptionRoundRect(
                ctx,
                word.x - layout.fontSize * 0.08,
                word.y + layout.fontSize * 0.06,
                word.width + layout.fontSize * 0.16,
                layout.fontSize * 1.02,
                layout.fontSize * 0.22,
              );
              ctx.restore();
            }
            ctx.save();
            applyCaptionCanvasShadow(ctx, style, scale);
            if (strokeWidth > 0.1) {
              ctx.lineWidth = strokeWidth;
              ctx.strokeStyle = strokeColor;
              ctx.strokeText(word.display, word.x, word.y + baseline);
            }
            ctx.fillStyle =
              animation === "word-pill" && status === "active" ? "#101010" : color;
            ctx.fillText(word.display, word.x, word.y + baseline);
            ctx.restore();
          }
        }
        ctx.restore();
      }
      function captionPaintKey(caption, style, boxWidth, scale) {
        return JSON.stringify({
          id: caption?.id || "",
          text: caption?.text || "",
          words: captionWordsOf(caption).map((word) => [word.display, word.start, word.end]),
          boxWidth,
          scale,
          lines: state.captionLines,
          font: [
            style.fontFamily,
            style.fontSize,
            style.fontWeight,
            style.fontItalic,
            style.letterSpacing,
            style.wordSpacing,
            style.lineHeight,
            style.textCase,
            style.textAlign,
          ],
          paint: [
            style.color,
            style.highlight,
            style.highlightEnabled,
            style.stroke,
            style.strokeColor,
            style.backgroundEnabled,
            style.backgroundMode,
            style.background,
            style.backgroundOpacity,
            style.backgroundWidth,
            style.backgroundHeight,
            style.backgroundX,
            style.backgroundY,
            style.radius,
            style.backgroundFitText,
            style.shadow,
            style.shadowDistance,
            style.shadowBlur,
            style.shadowAngle,
            style.shadowOpacity,
            style.shadowColor,
            style.animation,
          ],
        });
      }
      function applyCaptionCanvasHost(element, px = 1) {
        if (!element) return;
        applyTextBoxWidth(element, state.captionTransform.width, px);
        element.style.background = "transparent";
        element.style.padding = "0";
        element.style.borderRadius = "0";
        element.style.webkitTextStroke = "0px transparent";
        element.style.textShadow = "none";
        element.style.color = "transparent";
        element.style.lineHeight = "0";
        element.style.fontSize = "0";
      }
      function paintCaptionFrame(caption, style, time, boxWidth, scale = 1) {
        const api = captionTextLayout();
        const layout = layoutCaptionForCanvas(caption, style, boxWidth * scale, scale);
        const overflow =
          typeof api.captionPaintOverflow === "function"
            ? api.captionPaintOverflow(style, scale)
            : Math.ceil(Math.max(0, Number(style.stroke || 0)) * scale + 8);
        const width = Math.max(2, Math.ceil(layout.boxWidth + overflow * 2));
        const height = Math.max(2, Math.ceil(layout.boxHeight + overflow * 2));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, width, height);
        ctx.save();
        ctx.translate(overflow, overflow);
        paintCaptionToContext(ctx, layout, style, time, scale);
        ctx.restore();
        return { canvas, layout, overflow, width, height };
      }
      function paintCaptionPreview(element, caption, options = {}) {
        if (!element) return null;
        if (!caption) {
          element.replaceChildren();
          captionPaintState = { key: "", layout: null, style: null, pad: 0, caption: null };
          return null;
        }
        const style = state.captionStyle || {};
        const boxWidth = Number(state.captionTransform.width || state.width * 0.8);
        const key = captionPaintKey(caption, style, boxWidth, 1);
        const relayout = options.relayout !== false || captionPaintState.key !== key || !captionPaintState.layout;
        if (relayout) {
          const layout = layoutCaptionForCanvas(caption, style, boxWidth, 1);
          const api = captionTextLayout();
          const pad =
            typeof api.captionPaintOverflow === "function"
              ? api.captionPaintOverflow(style, 1)
              : 8;
          captionPaintState = { key, layout, style, pad, caption };
        }
        const layout = captionPaintState.layout;
        const pad = captionPaintState.pad || 0;
        const width = Math.max(2, Math.ceil((layout?.boxWidth || 2) + pad * 2));
        const height = Math.max(2, Math.ceil((layout?.boxHeight || 2) + pad * 2));
        let canvas = element.querySelector("canvas.caption-paint");
        if (!canvas) {
          element.replaceChildren();
          canvas = document.createElement("canvas");
          canvas.className = "caption-paint";
          element.appendChild(canvas);
        }
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, width, height);
        ctx.save();
        ctx.translate(pad, pad);
        paintCaptionToContext(ctx, layout, style, state.currentTime, 1);
        ctx.restore();
        const px = (($("frame")?.clientWidth) || state.width) / Math.max(1, state.width);
        canvas.style.width = `${width * px}px`;
        canvas.style.height = `${height * px}px`;
        return canvas;
      }
      function renderCaptionWords(element, caption) {
        paintCaptionPreview(element, caption, { relayout: true });
      }
      function paintCaptionSnapshot(preview, host, pad = 22) {
        void host;
        void pad;
        const canvas = preview?.querySelector("canvas.caption-paint");
        if (!canvas || canvas.width < 2 || canvas.height < 2) return null;
        return { canvas, sx: 0, sy: 0, sw: canvas.width, sh: canvas.height };
      }
      function estimatedCaptionWordWidth(display) {
        const fontSize = Number(state.captionStyle.fontSize || 54),
          letterSpacing = Number(state.captionStyle.letterSpacing || 0),
          weight = Number(state.captionStyle.fontWeight || 400),
          stroke = Math.max(0, Number(state.captionStyle.stroke || 0)),
          weightScale = weight >= 800 ? 1.2 : weight >= 600 ? 1.1 : 1,
          text = String(display || "");
        let units = 0;
        for (const character of text) {
          if (/[MW@%#&]/.test(character)) units += 0.8;
          else if (/[—–―]/.test(character)) units += 0.72;
          else if (/[ilI1'`.,:;!|]/.test(character)) units += 0.36;
          else if (/[A-Z0-9]/.test(character)) units += 0.66;
          else units += 0.62;
        }
        return units * fontSize * weightScale + Math.max(0, text.length - 1) * letterSpacing + stroke * 2;
      }
      function estimatedCaptionLineWidth(displays) {
        const items = (displays || []).map((item) => String(item || "").trim()).filter(Boolean);
        if (!items.length) return 0;
        const fontSize = Number(state.captionStyle.fontSize || 54);
        const gap = Number(state.captionStyle.wordSpacing || 0) + fontSize * 0.52;
        const trailing = fontSize * 0.24;
        let width = 0;
        items.forEach((word, index) => {
          const wordWidth = estimatedCaptionWordWidth(word);
          width = index ? width + gap + wordWidth : wordWidth;
        });
        return width + trailing;
      }
      function captionTwoLineBreak(words, requestedWidth) {
        const breaks = captionLineBreaks(words, requestedWidth, 2);
        return breaks[0] ?? -1;
      }
      function captionLineBreaks(words, requestedWidth, lineMode) {
        if (!Array.isArray(words) || words.length < 2) return [];
        const limit = captionWrapLineLimit(lineMode ?? state.captionLines);
        if (limit <= 1) return [];
        // Keep this identical to wrapCaptionWordList: same box width, 2-line
        // cap, and last-line overflow. Export ASS / Resolve use that helper.
        const canvas = Number(state.width || 1080);
        const box = Number(requestedWidth || state.captionTransform?.width || canvas * 0.8);
        const width = Math.max(160, Math.min(canvas, box));
        const displays = words.map((word) => word.display);
        if (estimatedCaptionLineWidth(displays) <= width) return [];
        const maxBreaks = Math.max(0, limit - 1);
        const breaks = [];
        let lineStart = 0;
        for (let index = 0; index < words.length; index += 1) {
          const candidate = estimatedCaptionLineWidth(displays.slice(lineStart, index + 1));
          if (index > lineStart && candidate > width && breaks.length < maxBreaks) {
            breaks.push(index);
            lineStart = index;
          }
        }
        return breaks;
      }
      function visualZ(key) {
        const index = state.trackOrder.indexOf(key);
        return Math.max(1, (state.trackOrder.length - index) * 10);
      }
      function updateSelectionBox() {
        const box = $("selectionBox"),
          frame = $("frame");
        let element = null;
        if (state.selected.type === "video") element = $("video");
        else if (state.selected.type === "caption")
          element = $("captionPreview");
        else if (state.selected.type === "review") element = $("reviewPreview");
        else
          element = frame.querySelector(
            `[data-type="${state.selected.type}"][data-id="${state.selected.id}"]`,
          );
        if (
          !element ||
          getComputedStyle(element).display === "none" ||
          getComputedStyle(element).visibility === "hidden"
        ) {
          box.classList.remove("on");
          return;
        }
        box.style.left = `${element.offsetLeft}px`;
        box.style.top = `${element.offsetTop}px`;
        box.style.width = `${element.offsetWidth}px`;
        box.style.height = `${element.offsetHeight}px`;
        box.style.transform = element.style.transform || "none";
        box.style.transformOrigin = getComputedStyle(element).transformOrigin || "center center";
        box.classList.toggle(
          "text-width",
          state.selected.type === "caption" || state.selected.type === "text",
        );
        box.classList.add("on");
      }
      function captionRasterOverlayOffset(frameW, frameH, x, y, w, h) {
        return {
          x: Number(x || 0) - (Number(frameW || 0) - Number(w || 0)) / 2,
          y: Number(y || 0) - (Number(frameH || 0) - Number(h || 0)) / 2,
        };
      }
      async function rasterizeCaptionsForExport() {
        const captions = (state.captions || []).filter(
          (item) =>
            String(item.text || "").trim() &&
            state.trackVisibility[item.trackId || "caption"] !== false,
        );
        if (!captions.length) return { images: [], directory: "" };
        const frameW = Math.round(state.width || 1080);
        const frameH = Math.round(state.height || 1920);
        const directory = await nativeCall("createCaptionRasterDir");
        const style = state.captionStyle || {};
        const scale = Math.max(0.2, Number(state.captionTransform.scale || 1));
        const boxWidth = Number(state.captionTransform.width || frameW * 0.8);
        const shiftX = Number(state.captionTransform.x || 0);
        const shiftY = Number(state.captionTransform.y || 0);
        const api = captionTextLayout();
        const highlightOn = style.highlightEnabled !== false;
        const images = [];
        let serial = 0;
        for (const caption of captions) {
          const segments =
            typeof api.captionHighlightSegments === "function"
              ? api.captionHighlightSegments(caption, highlightOn)
              : [{ start: Number(caption.start || 0), end: Number(caption.end || 0) }];
          for (const segment of segments) {
            const start = Number(segment.start || 0);
            const end = Number(segment.end || start);
            if (end <= start + 0.01) continue;
            const shot = paintCaptionFrame(caption, style, start + 0.001, boxWidth, scale);
            if (!shot?.canvas) continue;
            const frame = document.createElement("canvas");
            frame.width = frameW;
            frame.height = frameH;
            const ctx = frame.getContext("2d");
            ctx.clearRect(0, 0, frameW, frameH);
            ctx.drawImage(
              shot.canvas,
              frameW / 2 + shiftX - shot.width / 2,
              frameH / 2 + shiftY - shot.height / 2,
            );
            const dest = await nativeCall("writeCaptionRaster", {
              directory,
              name: `c${serial}.png`,
              dataUrl: frame.toDataURL("image/png"),
            });
            serial += 1;
            images.push({
              path: dest,
              start,
              end,
              x: 0,
              y: 0,
              pixelExact: true,
              fullFrame: true,
              sourceWidth: frameW,
              sourceHeight: frameH,
              opacity: 1,
              _quickCutCaptionRaster: true,
              trackId: "caption",
            });
          }
        }
        return { images, directory };
      }
      function applyTextBoxWidth(element, width, px = 1) {
        if (!element) return;
        const resolved = clamp(Number(width) || Number(state.width || 1080) * 0.8, 160, Number(state.width || 1080) * 1.5);
        element.style.width = `${resolved * px}px`;
        element.style.maxWidth = "none";
        element.style.boxSizing = "border-box";
        element.style.whiteSpace = "normal";
        element.style.overflow = "visible";
        element.style.overflowWrap = "normal";
        element.style.wordBreak = "normal";
      }
      function minimumTwoLineTextWidth(element, px = 1) {
        if (!element) return 160;
        const words = element.textContent.trim().split(/\s+/).filter(Boolean);
        if (!words.length) return 160;
        const gap = Number(state.captionStyle.fontSize || 54) * 0.28,
          widths = words.map(estimatedCaptionWordWidth),
          total = widths.reduce((sum, value) => sum + value, 0) + gap * (words.length - 1),
          longest = Math.max(...widths),
          padding = Number(state.captionStyle.backgroundWidth || 14) * 2;
        void px;
        return clamp(Math.max(longest + padding, total / 2 + padding), 160, state.width * 1.5);
      }
      function applyTextStyle(el, s, px = 1) {
        const content = el.querySelector(".textstyle-content") || el,
          backgroundMode = s.backgroundMode || "block",
          backgroundColor = s.backgroundEnabled
            ? hexAlpha(s.background || "#000", s.backgroundOpacity ?? 0.7)
            : "transparent",
          widthPad = Number(s.backgroundWidth ?? s.padding ?? 14) * px,
          heightPad = Number(s.backgroundHeight ?? s.padding ?? 14) * px,
          shadowStrength = clamp(Number(s.shadow ?? 0), 0, 10),
          shadowDistance = Number(s.shadowDistance ?? 0),
          shadowAngle = (Number(s.shadowAngle ?? 45) * Math.PI) / 180,
          shadowX = Math.cos(shadowAngle) * shadowDistance * px,
          shadowY = Math.sin(shadowAngle) * shadowDistance * px;
        el.style.fontFamily = `'${s.fontFamily || "Helvetica"}',sans-serif`;
        el.style.fontSize = `${Math.max(8, (s.fontSize || 54) * px)}px`;
        el.style.fontWeight = s.fontWeight || 700;
        el.style.fontStyle = s.fontItalic ? "italic" : "normal";
        el.style.textDecoration = s.fontUnderline ? "underline" : "none";
        el.style.textTransform =
          s.textCase === "upper"
            ? "uppercase"
            : s.textCase === "lower"
              ? "lowercase"
              : s.textCase === "title"
                ? "capitalize"
                : "none";
        el.style.letterSpacing = `${Number(s.letterSpacing || 0) * px}px`;
        el.style.wordSpacing = `${Number(s.wordSpacing || 0) * px}px`;
        el.style.lineHeight = String(Number(s.lineHeight || 1.15));
        el.style.whiteSpace = "normal";
        el.style.textAlign = s.textAlign || "center";
        el.style.color = s.color || "#fff";
        el.style.setProperty("--active", s.highlight || s.highlightColor || "#ffd21f");
        el.classList.toggle("no-highlight", s.highlightEnabled === false);
        // CSS strokes are geometrically centred on the glyph.  Painting the
        // fill after a stroke that is twice as wide hides the inner half and
        // leaves the requested width entirely outside the character.
        el.style.webkitTextStroke = `${Math.max(0, Number(s.stroke || 0)) * px * 2}px ${s.strokeColor || "#000"}`;
        el.style.paintOrder = "stroke fill";
        const shadows = [];
        const shadowOpacity = clamp(Number(s.shadowOpacity ?? 0.8), 0, 1);
        const shadowBlur = Math.max(0, Number(s.shadowBlur ?? 0));
        if (shadowStrength > 0.001 && shadowOpacity > 0.001) {
          const effectiveOpacity = shadowOpacity * (0.18 + 0.82 * (shadowStrength / 10));
          const effectiveBlur = Math.max(0.1, shadowBlur * px * (0.55 + shadowStrength * 0.07));
          shadows.push(`${shadowX.toFixed(2)}px ${shadowY.toFixed(2)}px ${effectiveBlur.toFixed(2)}px ${hexAlpha(s.shadowColor || "#000000", effectiveOpacity)}`);
        }
        const glowRadius = Math.max(0, Number(s.glow || 0)) * px;
        if (glowRadius > 0.1) {
          const glowColor = s.glowColor || s.color || "#ffffff";
          shadows.push(`0 0 ${(glowRadius * 0.38).toFixed(2)}px ${hexAlpha(glowColor, 0.78)}`);
          shadows.push(`0 0 ${(glowRadius * 0.82).toFixed(2)}px ${hexAlpha(glowColor, 0.48)}`);
          shadows.push(`0 0 ${(glowRadius * 1.55).toFixed(2)}px ${hexAlpha(glowColor, 0.23)}`);
        }
        const fitText = s.backgroundFitText !== false;
        el.style.textShadow = shadows.join(",");
        el.style.background =
          s.backgroundEnabled && backgroundMode === "block" && !fitText
            ? backgroundColor
            : "transparent";
        el.style.padding =
          s.backgroundEnabled && backgroundMode === "block" && !fitText
            ? `${heightPad}px ${widthPad}px`
            : "0";
        el.style.borderRadius =
          s.backgroundEnabled && backgroundMode === "block" && !fitText
            ? `${(s.radius || 0) * px}px`
            : "0";
        el.style.boxShadow = "none";
        content.classList.toggle(
          "line-background",
          !!s.backgroundEnabled && backgroundMode === "line",
        );
        content.classList.toggle(
          "block-fit-background",
          !!s.backgroundEnabled && backgroundMode === "block" && fitText,
        );
        const useContentBg =
          (s.backgroundEnabled && backgroundMode === "block" && fitText) ||
          (s.backgroundEnabled && backgroundMode === "line");
        content.style.background = useContentBg ? backgroundColor : "transparent";
        content.style.padding = useContentBg ? `${heightPad}px ${widthPad}px` : "0";
        content.style.borderRadius = useContentBg ? `${(s.radius || 0) * px}px` : "0";
        content.style.position = "relative";
        content.style.left = s.backgroundEnabled
          ? `${Number(s.backgroundX || 0) * px}px`
          : "0";
        content.style.top = s.backgroundEnabled
          ? `${Number(s.backgroundY || 0) * px}px`
          : "0";
        content.style.boxShadow = "none";
      }
      function hexAlpha(hex, a) {
        const h = String(hex).replace("#", "");
        const n = parseInt(
          h.length === 3
            ? h
                .split("")
                .map((x) => x + x)
                .join("")
            : h,
          16,
        );
        return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
      }
      